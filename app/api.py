"""Local web interface: sign in, manage forwarding tasks, run them."""

import logging
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .filters import sanitize
from .manager import LoginError, Manager
from .paths import WEB_DIR
from .store import Store, TaskNotFound

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

store = Store()
manager = Manager(store)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Resume any task that was running when we last stopped.
    try:
        if await manager.authorized():
            await manager.resume_enabled()
    except Exception as exc:  # noqa: BLE001 - never block startup on this
        manager.record(f"Could not resume tasks: {exc}", level="error")
    yield
    await manager.shutdown_client()


app = FastAPI(title="Telegram Forwarder", lifespan=lifespan)


# --------------------------------------------------------------------------
# Request bodies
# --------------------------------------------------------------------------


class LoginStart(BaseModel):
    api_id: int
    api_hash: str
    phone: str


class CodeSubmit(BaseModel):
    code: str


class PasswordSubmit(BaseModel):
    password: str


class TaskCreate(BaseModel):
    name: str = ""


class TaskUpdate(BaseModel):
    name: Optional[str] = None
    sources: Optional[List[int]] = None
    destinations: Optional[List[int]] = None
    mode: Optional[str] = None
    rules: Optional[Dict[str, Any]] = None


# --------------------------------------------------------------------------
# Error handling
# --------------------------------------------------------------------------


@app.exception_handler(LoginError)
async def login_error_handler(request, exc: LoginError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(TaskNotFound)
async def task_missing_handler(request, exc: TaskNotFound):
    return JSONResponse(status_code=404, content={"detail": str(exc)})


# --------------------------------------------------------------------------
# Session
# --------------------------------------------------------------------------


@app.get("/api/status")
async def get_status():
    return await manager.status()


@app.post("/api/login/start")
async def login_start(body: LoginStart):
    return await manager.start_login(body.api_id, body.api_hash.strip(), body.phone.strip())


@app.post("/api/login/code")
async def login_code(body: CodeSubmit):
    return await manager.submit_code(body.code)


@app.post("/api/login/password")
async def login_password(body: PasswordSubmit):
    return await manager.submit_password(body.password)


@app.post("/api/logout")
async def logout():
    await manager.logout()
    return {"ok": True}


@app.get("/api/chats")
async def chats():
    return await manager.list_chats()


# --------------------------------------------------------------------------
# Tasks
# --------------------------------------------------------------------------


@app.get("/api/tasks")
async def list_tasks():
    tasks = store.tasks()
    for task in tasks:
        task["running"] = manager.is_running(task["id"])
    return tasks


@app.post("/api/tasks")
async def create_task(body: TaskCreate):
    task = store.create_task(body.name)
    task["running"] = False
    return task


@app.post("/api/tasks/{task_id}")
async def update_task(task_id: str, body: TaskUpdate):
    changes = {k: v for k, v in body.model_dump().items() if v is not None}
    if "mode" in changes and changes["mode"] not in ("forward", "copy"):
        raise HTTPException(status_code=400, detail="mode must be 'forward' or 'copy'")
    if "name" in changes:
        changes["name"] = changes["name"].strip()
        if not changes["name"]:
            raise HTTPException(status_code=400, detail="A task needs a name.")

    if "rules" in changes:
        changes["rules"] = sanitize(changes["rules"])

    task = store.update_task(task_id, **changes)
    # A live task has its source list baked into its handler; re-register it.
    try:
        await manager.restart_if_running(task_id)
    except LoginError as exc:
        # The edit is saved either way; say why the task is no longer running.
        task["running"] = False
        task["warning"] = str(exc)
        return task
    task["running"] = manager.is_running(task_id)
    return task


@app.post("/api/tasks/{task_id}/delete")
async def delete_task(task_id: str):
    await manager.stop_task(task_id, persist=False)
    store.delete_task(task_id)
    return {"ok": True}


@app.post("/api/tasks/{task_id}/start")
async def start_task(task_id: str):
    task = await manager.start_task(task_id)
    task["running"] = manager.is_running(task_id)
    return task


@app.post("/api/tasks/{task_id}/stop")
async def stop_task(task_id: str):
    await manager.stop_task(task_id)
    task = store.task(task_id)
    task["running"] = False
    return task


@app.get("/api/log")
async def get_log():
    return list(manager.events)


# --------------------------------------------------------------------------
# Static
# --------------------------------------------------------------------------


@app.get("/")
async def index():
    return FileResponse(WEB_DIR / "index.html")


app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")
