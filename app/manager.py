"""Owns the Telegram user session and every running forwarding task.

One MTProto client, logged in as your own account, is used both to read the
source chats and to post into the destinations. Logging in here creates exactly
the kind of session you see under Settings -> Devices in Telegram, and it stays
on this machine.

Each task is an independent source-set to destination route with its own name,
mode and on/off switch. Tasks share the single client; each gets its own
Telethon event handler.
"""

import asyncio
import logging
from collections import deque
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Set

from telethon import TelegramClient, errors, events
from telethon.tl.types import MessageMediaWebPage

from .filters import evaluate, has_text_edits, rules_for
from .paths import LOG_FILE, SESSION_FILE, ensure_dirs
from .store import Store, TaskNotFound

log = logging.getLogger("forwarder")

# Retry ceiling for a single message. Telegram's rate limiter occasionally asks
# for a pause; anything longer than this is a problem to surface, not to sleep on.
MAX_FLOOD_WAIT = 300

# Outbound pacing, in seconds. Telegram limits both the total send rate for an
# account and the rate into any one chat, and the per-chat limit is much
# tighter. Staying under both by construction is cheaper than being throttled.
GLOBAL_SEND_INTERVAL = 0.25
PER_CHAT_SEND_INTERVAL = 1.5


class LoginError(Exception):
    """Anything the user can fix by re-entering something."""


class Manager:
    def __init__(self, store: Store) -> None:
        self.store = store
        self.client: Optional[TelegramClient] = None
        self._handlers: Dict[str, Callable] = {}
        self._phone: Optional[str] = None
        self._phone_code_hash: Optional[str] = None
        self._lock = asyncio.Lock()
        self.events = deque(maxlen=300)
        # Send pacing: the next moment a send may leave, overall and per chat.
        self._pace_lock = asyncio.Lock()
        self._next_send = 0.0
        self._next_send_to: Dict[int, float] = {}

    # ------------------------------------------------------------------
    # Activity log
    # ------------------------------------------------------------------

    def record(self, text: str, level: str = "info", task: Optional[str] = None) -> None:
        entry = {
            "time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "level": level,
            "task": task,
            "text": text,
        }
        self.events.appendleft(entry)
        log.info(f"[{task}] {text}" if task else text)
        try:
            ensure_dirs()
            with LOG_FILE.open("a", encoding="utf-8") as fh:
                prefix = f"[{task}] " if task else ""
                fh.write(f"{entry['time']} {level.upper()} {prefix}{text}\n")
        except OSError:
            pass

    # ------------------------------------------------------------------
    # Client lifecycle
    # ------------------------------------------------------------------

    async def _client_for(self, api_id: int, api_hash: str) -> TelegramClient:
        if self.client is None:
            ensure_dirs()
            self.client = TelegramClient(str(SESSION_FILE), api_id, api_hash)
        if not self.client.is_connected():
            await self.client.connect()
        return self.client

    async def ensure_client(self) -> TelegramClient:
        creds = self.store.credentials()
        if not creds:
            raise LoginError("No API credentials saved yet.")
        return await self._client_for(creds["api_id"], creds["api_hash"])

    async def authorized(self) -> bool:
        if not self.store.credentials():
            return False
        try:
            client = await self.ensure_client()
        except (LoginError, OSError):
            return False
        return await client.is_user_authorized()

    async def status(self) -> Dict[str, Any]:
        creds = self.store.credentials()
        tasks = self.store.tasks()
        for task in tasks:
            task["running"] = task["id"] in self._handlers

        state: Dict[str, Any] = {
            "has_credentials": creds is not None,
            "authorized": False,
            "awaiting": "code" if self._phone_code_hash else None,
            "account": None,
            "tasks": tasks,
        }
        if creds and await self.authorized():
            state["authorized"] = True
            state["awaiting"] = None
            me = await self.client.get_me()
            state["account"] = {
                "id": me.id,
                "name": " ".join(filter(None, [me.first_name, me.last_name])).strip(),
                "username": me.username,
                "phone": me.phone,
            }
        return state

    # ------------------------------------------------------------------
    # Login, mirroring Telegram's own sign-in flow
    # ------------------------------------------------------------------

    async def start_login(self, api_id: int, api_hash: str, phone: str) -> Dict[str, Any]:
        self.store.save_credentials(api_id, api_hash)
        # Credentials may have changed; drop any half-built client.
        if self.client is not None:
            await self.shutdown_client()
        client = await self._client_for(int(api_id), api_hash)

        if await client.is_user_authorized():
            return {"stage": "authorized"}

        try:
            sent = await client.send_code_request(phone)
        except errors.PhoneNumberInvalidError:
            raise LoginError("That phone number is not valid. Include the country code.")
        except errors.ApiIdInvalidError:
            raise LoginError("The api_id and api_hash pair was rejected by Telegram.")
        except errors.FloodWaitError as exc:
            raise LoginError(f"Telegram is rate limiting sign-in. Try again in {exc.seconds}s.")

        self._phone = phone
        self._phone_code_hash = sent.phone_code_hash
        self.record(f"Login code requested for {phone}")
        return {"stage": "code"}

    async def submit_code(self, code: str) -> Dict[str, Any]:
        if not self._phone_code_hash:
            raise LoginError("No sign-in is in progress. Start again.")
        client = await self.ensure_client()
        try:
            await client.sign_in(
                phone=self._phone,
                code=code.strip(),
                phone_code_hash=self._phone_code_hash,
            )
        except errors.SessionPasswordNeededError:
            # Two-step verification is on; the cloud password is the next step.
            return {"stage": "password"}
        except errors.PhoneCodeInvalidError:
            raise LoginError("That code is not correct.")
        except errors.PhoneCodeExpiredError:
            self._phone_code_hash = None
            raise LoginError("That code expired. Request a new one.")

        self._phone_code_hash = None
        self.record("Signed in successfully")
        return {"stage": "authorized"}

    async def submit_password(self, password: str) -> Dict[str, Any]:
        client = await self.ensure_client()
        try:
            await client.sign_in(password=password)
        except errors.PasswordHashInvalidError:
            raise LoginError("That two-step verification password is not correct.")

        self._phone_code_hash = None
        self.record("Signed in successfully (two-step verification)")
        return {"stage": "authorized"}

    async def logout(self) -> None:
        await self.stop_all()
        if self.client is not None:
            if not self.client.is_connected():
                await self.client.connect()
            await self.client.log_out()
            self.client = None
        self._phone = None
        self._phone_code_hash = None
        self.record("Logged out and session revoked")

    async def shutdown_client(self) -> None:
        """Disconnect without revoking the session, for a clean process exit."""
        await self.stop_all(persist=False)
        if self.client is not None and self.client.is_connected():
            await self.client.disconnect()
        self.client = None

    # ------------------------------------------------------------------
    # Chats
    # ------------------------------------------------------------------

    async def list_chats(self) -> List[Dict[str, Any]]:
        client = await self.ensure_client()
        if not await client.is_user_authorized():
            raise LoginError("Not signed in.")

        chats: List[Dict[str, Any]] = []
        async for dialog in client.iter_dialogs():
            if not (dialog.is_group or dialog.is_channel):
                continue
            entity = dialog.entity
            broadcast = bool(getattr(entity, "broadcast", False))
            chats.append(
                {
                    "id": dialog.id,
                    "title": dialog.name or "(untitled)",
                    "kind": "channel" if broadcast else "group",
                    "username": getattr(entity, "username", None),
                }
            )
        chats.sort(key=lambda c: c["title"].lower())
        return chats

    # ------------------------------------------------------------------
    # Tasks
    # ------------------------------------------------------------------

    def is_running(self, task_id: str) -> bool:
        return task_id in self._handlers

    def _validate(self, task: Dict[str, Any]) -> None:
        name = task["name"]
        if not task["sources"]:
            raise LoginError(f"'{name}' has no source chats.")
        if not task["destinations"]:
            raise LoginError(f"'{name}' has no destination chats.")
        overlap = set(task["destinations"]) & set(task["sources"])
        if overlap:
            raise LoginError(f"'{name}' sends into one of its own sources, which would loop.")
        if task["mode"] not in ("forward", "copy"):
            raise LoginError(f"'{name}' has an unknown mode.")
        if task["mode"] == "forward" and has_text_edits(rules_for(task)):
            raise LoginError(
                f"'{name}' edits message text, which only works in copy mode. "
                "A forward is the original message untouched."
            )
        self._check_for_loop(task)

    def _check_for_loop(self, candidate: Dict[str, Any]) -> None:
        """Two tasks pointing at each other relay forever. Walk the graph of
        running routes plus this one and refuse if it closes a cycle."""
        edges: Dict[int, Set[int]] = {}
        routes = [t for t in self.store.tasks() if self.is_running(t["id"])]
        routes = [t for t in routes if t["id"] != candidate["id"]] + [candidate]
        for task in routes:
            for source in task["sources"]:
                edges.setdefault(source, set()).update(task["destinations"])

        visiting: Set[int] = set()
        done: Set[int] = set()

        def walk(node: int) -> bool:
            if node in visiting:
                return True
            if node in done:
                return False
            visiting.add(node)
            for nxt in edges.get(node, ()):
                if walk(nxt):
                    return True
            visiting.discard(node)
            done.add(node)
            return False

        for start in list(edges):
            if walk(start):
                raise LoginError(
                    f"'{candidate['name']}' would create a forwarding loop with a "
                    "task that is already running."
                )

    async def start_task(self, task_id: str) -> Dict[str, Any]:
        async with self._lock:
            task = self.store.task(task_id)
            if self.is_running(task_id):
                return task
            self._validate(task)

            client = await self.ensure_client()
            if not await client.is_user_authorized():
                raise LoginError("Not signed in.")

            handler = self._make_handler(task_id)
            client.add_event_handler(handler, events.NewMessage(chats=list(task["sources"])))
            self._handlers[task_id] = handler
            self.store.update_task(task_id, enabled=True)
            self.record(
                f"Started: {len(task['sources'])} source(s) -> "
                f"{len(task['destinations'])} destination(s) in {task['mode']} mode",
                task=task["name"],
            )
            return self.store.task(task_id)

    async def stop_task(self, task_id: str, persist: bool = True) -> None:
        handler = self._handlers.pop(task_id, None)
        if handler is not None and self.client is not None:
            self.client.remove_event_handler(handler)
        if persist:
            try:
                task = self.store.update_task(task_id, enabled=False)
                if handler is not None:
                    self.record("Stopped", task=task["name"])
            except TaskNotFound:
                pass

    async def stop_all(self, persist: bool = True) -> None:
        for task_id in list(self._handlers):
            await self.stop_task(task_id, persist=persist)

    async def restart_if_running(self, task_id: str) -> None:
        """Apply an edit to a task that is live. The source list is baked into
        the Telethon handler, so it has to be re-registered."""
        if not self.is_running(task_id):
            return
        await self.stop_task(task_id, persist=False)
        await self.start_task(task_id)

    async def resume_enabled(self) -> None:
        for task in self.store.tasks():
            if not task["enabled"]:
                continue
            try:
                await self.start_task(task["id"])
            except LoginError as exc:
                self.record(f"Could not resume: {exc}", level="error", task=task["name"])

    # ------------------------------------------------------------------
    # Relaying
    # ------------------------------------------------------------------

    def _make_handler(self, task_id: str) -> Callable:
        async def handler(event) -> None:
            await self._relay(task_id, event)

        return handler

    async def _relay(self, task_id: str, event) -> None:
        try:
            # Read fresh so a mode change applies without a restart.
            task = self.store.task(task_id)
        except TaskNotFound:
            return

        source_id = event.chat_id
        message = event.message
        relay, text = evaluate(message, source_id, task)
        if not relay:
            return

        # Keyed per task: the same source may legitimately feed two destinations.
        key = f"{task_id}:{source_id}:{message.id}"
        if not self.store.mark_seen(key):
            return

        name = task["name"]
        destinations = task["destinations"]
        delivered = 0
        for destination in destinations:
            if await self._send_one(name, destination, message, task["mode"], source_id, text):
                delivered += 1

        if delivered:
            preview = (message.text or "[media]").replace("\n", " ")[:60]
            suffix = f" to {delivered} of {len(destinations)} destinations" if len(
                destinations
            ) > 1 else ""
            self.record(f"Relayed {message.id}{suffix}: {preview}", task=name)

    async def _send_one(
        self,
        name: str,
        destination: int,
        message,
        mode: str,
        source_id: int,
        text: Optional[str] = None,
    ) -> bool:
        """Deliver to one destination. A failure here must not stop the others."""
        try:
            await self._deliver(destination, message, mode, text)
            return True
        except errors.ChatForwardsRestrictedError:
            self.record(
                f"Source {source_id} blocks forwarding. Switch this task to copy mode.",
                level="error",
                task=name,
            )
        except errors.FloodWaitError as exc:
            if exc.seconds > MAX_FLOOD_WAIT:
                self.record(
                    f"Rate limited for {exc.seconds}s, dropping message {message.id}",
                    level="error",
                    task=name,
                )
                return False
            self.record(f"Rate limited, waiting {exc.seconds}s", level="warn", task=name)
            await asyncio.sleep(exc.seconds + 1)
            try:
                await self._deliver(destination, message, mode, text)
                return True
            except Exception as exc2:  # noqa: BLE001 - report, keep going
                self.record(
                    f"Failed to relay {message.id} to {destination}: {exc2}",
                    level="error",
                    task=name,
                )
        except Exception as exc:  # noqa: BLE001 - one bad message must not stop the task
            self.record(
                f"Failed to relay {message.id} to {destination}: {exc}",
                level="error",
                task=name,
            )
        return False

    async def _pace(self, destination: int) -> None:
        """Claim the next send slot for this chat, then wait for it.

        The slot is reserved under the lock and slept for outside it, so a
        message queued behind a slow chat does not hold up every other task.
        """
        loop = asyncio.get_running_loop()
        async with self._pace_lock:
            now = loop.time()
            # The global tick this send consumes. Waiting out a chat's own
            # cooldown must not advance it, or one busy chat would hold up
            # every other destination behind it.
            tick = max(now, self._next_send)
            slot = max(tick, self._next_send_to.get(destination, 0.0))
            self._next_send = tick + GLOBAL_SEND_INTERVAL
            self._next_send_to[destination] = slot + PER_CHAT_SEND_INTERVAL
            # Forget chats whose cooldown has long passed, so this cannot grow
            # without bound over a long run.
            if len(self._next_send_to) > 64:
                self._next_send_to = {
                    chat: when for chat, when in self._next_send_to.items() if when > now
                }
            delay = slot - now

        if delay > 0:
            await asyncio.sleep(delay)

    async def _deliver(
        self, destination: int, message, mode: str, text: Optional[str] = None
    ) -> None:
        await self._pace(destination)
        if mode != "copy":
            await self.client.forward_messages(destination, message)
            return

        # Copy re-sends the content as a message of your own, with no
        # "Forwarded from" header.
        if text is None:
            await self.client.send_message(destination, message)
        elif message.media is not None and not isinstance(message.media, MessageMediaWebPage):
            # Rewritten caption on the original media.
            await self.client.send_message(destination, text, file=message.media)
        else:
            await self.client.send_message(destination, text)
