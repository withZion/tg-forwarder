"""Filesystem layout. Everything mutable lives under DATA_DIR so a single
volume mount is enough to make the app stateful on any host."""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("DATA_DIR", ROOT / "data"))
WEB_DIR = ROOT / "web"

SESSION_DIR = DATA_DIR / "session"
SESSION_FILE = SESSION_DIR / "forwarder"  # Telethon appends .session
CREDENTIALS_FILE = DATA_DIR / "credentials.json"
CONFIG_FILE = DATA_DIR / "config.json"
SEEN_FILE = DATA_DIR / "seen.json"
LOG_FILE = DATA_DIR / "forwarder.log"


def ensure_dirs() -> None:
    SESSION_DIR.mkdir(parents=True, exist_ok=True)
