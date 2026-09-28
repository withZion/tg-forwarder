"""Small JSON-file persistence. No database; the volume of state here is a
handful of ids and a rolling set of already-relayed messages."""

import json
import uuid
from typing import Any, Dict, List, Optional

from .filters import DEFAULT_RULES
from .paths import CONFIG_FILE, CREDENTIALS_FILE, SEEN_FILE, ensure_dirs

# How many relayed message keys to remember for de-duplication.
SEEN_LIMIT = 5000

CONFIG_VERSION = 4


def new_task(name: str) -> Dict[str, Any]:
    return {
        "id": uuid.uuid4().hex[:12],
        "name": name,
        "sources": [],
        "destinations": [],
        "mode": "forward",  # "forward" keeps the header, "copy" re-sends as your own
        "rules": dict(DEFAULT_RULES),
        "enabled": False,
    }


def _read(path, fallback):
    if not path.exists():
        return fallback
    try:
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except (json.JSONDecodeError, OSError):
        return fallback


def _write(path, value) -> None:
    ensure_dirs()
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as fh:
        json.dump(value, fh, indent=2)
    tmp.replace(path)


def _migrate(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Carry older config shapes forward so an existing setup keeps working.

    Version 1 held a single forwarder at the top level; version 2 introduced
    named tasks with one destination each; version 3 allows several; version 4
    adds per-task relay rules.
    """
    version = raw.get("version")
    if version == CONFIG_VERSION:
        return raw

    if version is None and ("sources" in raw or "destination" in raw):
        task = new_task("Forwarder")
        destination = raw.get("destination")
        task.update(
            {
                "sources": raw.get("sources", []),
                "destinations": [destination] if destination else [],
                "mode": raw.get("mode", "forward"),
                "enabled": raw.get("enabled", False),
            }
        )
        tasks = [task]
    else:
        tasks = raw.get("tasks", [])
        for task in tasks:
            if "destinations" not in task:
                destination = task.pop("destination", None)
                task["destinations"] = [destination] if destination else []

    for task in tasks:
        task.setdefault("rules", dict(DEFAULT_RULES))

    return {"version": CONFIG_VERSION, "tasks": tasks}


class TaskNotFound(Exception):
    pass


class Store:
    def __init__(self) -> None:
        self._seen: List[str] = _read(SEEN_FILE, [])
        self._seen_set = set(self._seen)

    # --- API credentials (api_id / api_hash from my.telegram.org) ---

    def credentials(self) -> Optional[Dict[str, Any]]:
        creds = _read(CREDENTIALS_FILE, None)
        if creds and creds.get("api_id") and creds.get("api_hash"):
            return creds
        return None

    def save_credentials(self, api_id: int, api_hash: str) -> None:
        _write(CREDENTIALS_FILE, {"api_id": int(api_id), "api_hash": api_hash})

    # --- Tasks ---

    def _config(self) -> Dict[str, Any]:
        raw = _read(CONFIG_FILE, {})
        config = _migrate(raw)
        if config is not raw:
            # Persist immediately. Migration mints task ids, so re-running it on
            # every read would hand out a different id each time.
            _write(CONFIG_FILE, config)
        return config

    def tasks(self) -> List[Dict[str, Any]]:
        return self._config()["tasks"]

    def task(self, task_id: str) -> Dict[str, Any]:
        for task in self.tasks():
            if task["id"] == task_id:
                return task
        raise TaskNotFound(f"No task with id {task_id}")

    def create_task(self, name: str) -> Dict[str, Any]:
        config = self._config()
        task = new_task(name.strip() or f"Task {len(config['tasks']) + 1}")
        config["tasks"].append(task)
        _write(CONFIG_FILE, config)
        return task

    def update_task(self, task_id: str, **changes) -> Dict[str, Any]:
        config = self._config()
        for task in config["tasks"]:
            if task["id"] == task_id:
                task.update(changes)
                _write(CONFIG_FILE, config)
                return task
        raise TaskNotFound(f"No task with id {task_id}")

    def delete_task(self, task_id: str) -> None:
        config = self._config()
        remaining = [t for t in config["tasks"] if t["id"] != task_id]
        if len(remaining) == len(config["tasks"]):
            raise TaskNotFound(f"No task with id {task_id}")
        config["tasks"] = remaining
        _write(CONFIG_FILE, config)

    # --- De-duplication ---

    def mark_seen(self, key: str) -> bool:
        """Record a relayed message. Returns False if it was already relayed."""
        if key in self._seen_set:
            return False
        self._seen.append(key)
        self._seen_set.add(key)
        if len(self._seen) > SEEN_LIMIT:
            dropped = self._seen[:-SEEN_LIMIT]
            self._seen = self._seen[-SEEN_LIMIT:]
            self._seen_set.difference_update(dropped)
        _write(SEEN_FILE, self._seen)
        return True
