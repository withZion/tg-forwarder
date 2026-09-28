"""Relay rules: what to drop, and what to change before sending.

Every message a task picks up passes through `evaluate`. It answers two
questions at once: should this be relayed at all, and should its text be
rewritten first. Rewriting is only possible in copy mode, because a native
forward is the original message untouched.
"""

import re
from typing import Any, Dict, List, Optional, Tuple

from telethon.tl.types import MessageMediaWebPage

URL_RE = re.compile(r"(?:https?://|www\.|t\.me/)\S+", re.IGNORECASE)
MENTION_RE = re.compile(r"(?<![\w@])@[A-Za-z][A-Za-z0-9_]{3,}")

DEFAULT_RULES: Dict[str, Any] = {
    # Drop rules
    "allow": [],  # if non-empty, the text must contain one of these
    "block": [],  # if the text contains any of these, drop it
    "skip_media": False,  # drop photos, video, files
    "skip_text_only": False,  # drop messages that carry no media
    "require_link": False,  # drop anything without a link
    "skip_forwards": False,  # drop messages already forwarded from elsewhere
    # Text edits (copy mode only)
    "strip_links": False,
    "strip_mentions": False,
    "replacements": [],  # [{"find": "...", "replace": "..."}]
    "footer": "",
}

# Which rules cannot take effect in forward mode.
TEXT_EDIT_KEYS = ("strip_links", "strip_mentions", "replacements", "footer")


def rules_for(task: Dict[str, Any]) -> Dict[str, Any]:
    """Task rules merged over the defaults, so older tasks stay valid."""
    rules = dict(DEFAULT_RULES)
    rules.update(task.get("rules") or {})
    return rules


def has_text_edits(rules: Dict[str, Any]) -> bool:
    return any(rules.get(key) for key in TEXT_EDIT_KEYS)


def sanitize(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Coerce rules coming from the UI into the shape the engine expects."""
    rules = dict(DEFAULT_RULES)
    for key, default in DEFAULT_RULES.items():
        if key not in raw:
            continue
        value = raw[key]
        if isinstance(default, bool):
            rules[key] = bool(value)
        elif key in ("allow", "block"):
            rules[key] = [str(v).strip() for v in (value or []) if str(v).strip()]
        elif key == "replacements":
            pairs: List[Dict[str, str]] = []
            for item in value or []:
                find = str(item.get("find", "")).strip()
                if find:
                    pairs.append({"find": find, "replace": str(item.get("replace", ""))})
            rules[key] = pairs
        elif key == "footer":
            rules[key] = str(value or "")
    return rules


def _real_media(message) -> bool:
    """A link preview is not media in the sense anyone means it."""
    return message.media is not None and not isinstance(message.media, MessageMediaWebPage)


def _has_link(message, text: str) -> bool:
    if URL_RE.search(text):
        return True
    return isinstance(message.media, MessageMediaWebPage)


def evaluate(message, source_id: int, task: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
    """Decide the fate of one message.

    Returns (relay, text). `text` is None when the message should go out
    unchanged; otherwise it is the rewritten text to send in its place.
    """
    rules = rules_for(task)
    text = message.text or ""
    media = _real_media(message)

    # Service messages (joins, pins, title changes) carry no content to relay.
    if not text and message.media is None:
        return False, None

    if rules["skip_forwards"] and message.fwd_from is not None:
        return False, None
    if rules["skip_media"] and media:
        return False, None
    if rules["skip_text_only"] and not media:
        return False, None
    if rules["require_link"] and not _has_link(message, text):
        return False, None

    haystack = text.lower()
    if rules["allow"] and not any(word.lower() in haystack for word in rules["allow"]):
        return False, None
    if any(word.lower() in haystack for word in rules["block"]):
        return False, None

    if task.get("mode") != "copy" or not has_text_edits(rules):
        return True, None

    edited = text
    for pair in rules["replacements"]:
        edited = edited.replace(pair["find"], pair["replace"])
    if rules["strip_links"]:
        edited = URL_RE.sub("", edited)
    if rules["strip_mentions"]:
        edited = MENTION_RE.sub("", edited)

    # Editing leaves ragged whitespace behind; tidy it without touching layout.
    edited = re.sub(r"[ \t]{2,}", " ", edited)
    edited = re.sub(r"\n{3,}", "\n\n", edited).strip()

    if rules["footer"]:
        edited = f"{edited}\n\n{rules['footer']}" if edited else rules["footer"]

    # Nothing left worth sending.
    if not edited and not media:
        return False, None
    return True, edited
