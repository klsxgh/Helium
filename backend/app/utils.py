"""Small shared utilities used across Helium's backend."""

from __future__ import annotations

import hashlib
import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any

TOKEN_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9'’._$%-]*")
WORD_RE = re.compile(r"\b[\w'’-]+\b", re.UNICODE)
SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'“(])")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:20]}"


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def json_loads(value: str | None, default: Any = None) -> Any:
    if value is None or value == "":
        return default
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return default


def tokenize(text: str) -> list[str]:
    return [token.lower() for token in WORD_RE.findall(text)]


def token_count(text: str) -> int:
    return len(WORD_RE.findall(text))


def split_sentences(text: str) -> list[str]:
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return []
    # Protect common abbreviations before splitting.
    protected = text
    for abbreviation in (
        "U.S.",
        "U.K.",
        "E.U.",
        "e.g.",
        "i.e.",
        "etc.",
        "Mr.",
        "Mrs.",
        "Ms.",
        "Dr.",
        "Inc.",
        "Ltd.",
        "Corp.",
        "vs.",
        "No.",
    ):
        protected = protected.replace(abbreviation, abbreviation.replace(".", "§"))
    sentences = [s.replace("§", ".").strip() for s in SENTENCE_SPLIT_RE.split(protected)]
    if not sentences:
        return [text]
    # Merge fragments that are too short to be useful on their own.
    merged: list[str] = []
    for sentence in sentences:
        if merged and len(sentence.split()) < 3:
            merged[-1] = f"{merged[-1]} {sentence}".strip()
        else:
            merged.append(sentence)
    return [sentence for sentence in merged if sentence]


def truncate(text: str, max_chars: int = 4000) -> str:
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 1].rstrip() + "…"


def normalize_whitespace(text: str) -> str:
    text = text.replace("\x00", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n[ \t]+", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def safe_filename(name: str) -> str:
    name = name.replace("\\", "/").split("/")[-1]
    name = re.sub(r"[^A-Za-z0-9._ -]", "_", name).strip(". ")
    return name[:180] or "document.txt"
