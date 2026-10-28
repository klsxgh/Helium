"""Rule-guided linguistic claim extraction.

Each retrieved chunk is decomposed into sentence-level claims with entity,
modality, negation, numeric constraints, and conditional scope. spaCy supplies
dependency parses and named entities when available; deterministic regex rules
remain the source of truth for policy semantics.
"""

from __future__ import annotations

import hashlib
import logging
import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from ..config import get_settings
from ..utils import split_sentences, tokenize

logger = logging.getLogger("helium.extractor")

GENERIC_HEADINGS = {
    "policy",
    "policies",
    "overview",
    "purpose",
    "scope",
    "introduction",
    "general",
    "details",
    "summary",
    "definitions",
    "procedure",
    "procedures",
    "guidelines",
    "policy statement",
    "applicability",
    "effective date",
}

PROHIBITION_RE = re.compile(
    r"\b(?:must|shall|may)\s+not\b|\b(?:is|are|was|were)\s+not\s+(?:permitted|allowed|authorized)\b|"
    r"\b(?:prohibited|forbidden)\b|\b(?:cannot|can't)\b|\bnot\s+(?:allowed|permitted|authorized)\b|"
    r"\bunder no circumstances\b|\bno\s+(?:employee|employees|person|persons|one|expense|expenses|travel)\s+"
    r"(?:may|shall|can|is|are)\b",
    re.I,
)
OPTIONAL_RE = re.compile(
    r"\b(?:not\s+required|not\s+necessary|optional|at\s+(?:the\s+)?(?:sole\s+)?discretion|"
    r"may\s+be\s+submitted|may\s+submit|is\s+permitted|are\s+permitted|is\s+allowed|are\s+allowed|"
    r"is\s+entitled|are\s+entitled)\b",
    re.I,
)
MUST_RE = re.compile(
    r"\b(?:must|shall|required|mandatory|have\s+to|has\s+to|need\s+to|needs\s+to|"
    r"is\s+required|are\s+required|will\s+be\s+required)\b",
    re.I,
)
SHOULD_RE = re.compile(
    r"\b(?:should|ought\s+to|recommended|strongly\s+encouraged|advisable|expected\s+to)\b",
    re.I,
)
MAY_RE = re.compile(
    r"\b(?:may|can|permitted|allowed|authorized|optional|at\s+(?:the\s+)?(?:sole\s+)?discretion)\b",
    re.I,
)
NEGATION_RE = re.compile(
    r"\b(?:not|no|never|neither|nor|without|prohibited|forbidden|cannot|can't|mustn't|"
    r"except|excluding|unless)\b",
    re.I,
)
CONDITION_RE = re.compile(
    r"(?:^|[,;]\s*|\b)(?:if|when|whenever|unless|provided\s+that|in\s+the\s+event|"
    r"subject\s+to|for\s+(?:all\s+)?(?:travel|expenses?|employees?|senior\s+employees?|"
    r"contractors?|managers?|purchases?|requests?|business\s+expenses?)|"
    r"(?:travel|expenses?|purchases?|requests?|employees?)\s+(?:above|over|under|below|"
    r"exceeding|up\s+to)|regardless\s+of)\b[^.;]{2,140}",
    re.I,
)
MONEY_RE = re.compile(
    r"(?:US\$|USD|\$)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|m|million|billion))?", re.I
)
PERCENT_RE = re.compile(r"\b\d+(?:\.\d+)?\s?%")
DATE_RE = re.compile(
    r"\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{4}|"
    r"(?:January|February|March|April|May|June|July|August|September|October|November|December|"
    r"Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4})\b",
    re.I,
)
DURATION_RE = re.compile(
    r"\b\d+(?:\.\d+)?\s+(?:business\s+|calendar\s+|working\s+)?"
    r"(?:days?|weeks?|months?|years?|hours?|minutes?)(?:\s+(?:per|a|each)\s+"
    r"(?:day|week|month|year))?",
    re.I,
)
LIMIT_RE = re.compile(
    r"\b(?:at\s+least|at\s+most|no\s+more\s+than|no\s+fewer\s+than|fewer\s+than|"
    r"more\s+than|up\s+to|minimum(?:\s+of)?|maximum(?:\s+of)?|within|"
    r"after|before)\s+(?:US\$|USD|\$)?\s?\d[\d,]*(?:\.\d+)?"
    r"(?:\s+(?:business\s+|calendar\s+|working\s+)?(?:days?|weeks?|months?|hours?|minutes?|"
    r"employees?|people|percent|%))?",
    re.I,
)
RANGE_RE = re.compile(r"\b\d+(?:\.\d+)?\s*(?:-|–|to)\s*\d+(?:\.\d+)?\b")
TABLE_OF_CONTENTS_RE = re.compile(r"(?:\.{3,}|\u2026{2,})\s*\d+\s*$")
LEGAL_FRAGMENT_RE = re.compile(
    r"^(?:confidential|all rights reserved|copyright|page \d+|table of contents)\b", re.I
)
METADATA_ONLY_RE = re.compile(
    r"^(?:effective\s+date|revision|version|issued|updated|revised|prepared\s+by|"
    r"approved\s+by|document\s+(?:id|number)|next\s+review|review\s+date)\b",
    re.I,
)


@lru_cache(maxsize=1)
def get_nlp():
    settings = get_settings()
    try:
        import spacy  # type: ignore

        try:
            nlp = spacy.load(settings.spacy_model)
            logger.info("Loaded spaCy model %s", settings.spacy_model)
            return nlp
        except Exception as exc:
            logger.warning("spaCy model %s unavailable; using blank pipeline: %s", settings.spacy_model, exc)
            try:
                nlp = spacy.blank("en")
                if "sentencizer" not in nlp.pipe_names:
                    nlp.add_pipe("sentencizer")
                return nlp
            except Exception:
                return None
    except ImportError:
        logger.warning("spaCy not installed; claim extraction will use regex rules only.")
        return None


def _clean_heading(heading: str | None) -> str | None:
    if not heading:
        return None
    value = re.sub(r"^(?:section|article|part|chapter)\s+\d+(?:\.\d+)*[.:)]?\s*", "", heading, flags=re.I)
    value = re.sub(r"^\d+(?:\.\d+){0,3}[.)]?\s+", "", value)
    value = value.strip(" .:-")
    if not value or value.lower() in GENERIC_HEADINGS or len(value) > 140:
        return None
    return value


def _subject_of(sentence: Any) -> tuple[str, str, str]:
    """Return (entity, action, object) from a spaCy sentence."""
    subject = ""
    action = ""
    object_text = ""
    if not hasattr(sentence, "root"):
        return subject, action, object_text
    root = sentence.root
    for token in sentence:
        if token.dep_ in {"nsubj", "nsubjpass", "csubj"} and not subject:
            subject = " ".join(
                child.text
                for child in token.subtree
                if not child.is_punct and child.dep_ not in {"mark", "advcl"}
            )
    if not subject:
        for chunk in sentence.noun_chunks:
            if chunk.root.head == root or chunk.start < root.i:
                subject = chunk.text
                break
    verbs = [
        token
        for token in sentence
        if token.pos_ in {"VERB", "AUX"} and token.dep_ in {"ROOT", "xcomp", "relcl", "acl", "ccomp"}
    ]
    if root.pos_ == "VERB":
        action = root.lemma_
    elif verbs:
        action = next((token.lemma_ for token in verbs if token.lemma_ != "be"), root.lemma_)
    else:
        action = root.lemma_
    object_parts: list[str] = []
    for token in root.children:
        if token.dep_ in {"dobj", "obj", "attr", "pobj", "dative"}:
            object_parts.append(
                " ".join(child.text for child in token.subtree if not child.is_punct)
            )
    if not object_parts and root.pos_ not in {"VERB", "AUX"}:
        for child in root.children:
            if child.dep_ in {"prep", "acomp"}:
                object_parts.append(
                    " ".join(grand.text for grand in child.subtree if not grand.is_punct)
                )
    object_text = ", ".join(dict.fromkeys(part for part in object_parts if part)).strip()
    return subject.strip(), action.strip(), object_text.strip()


def _entity_key(*parts: str | None) -> str:
    tokens: list[str] = []
    for part in parts:
        for token in tokenize(part or ""):
            if token in {
                "the",
                "a",
                "an",
                "all",
                "any",
                "each",
                "this",
                "that",
                "these",
                "those",
                "of",
                "for",
                "to",
                "in",
                "on",
                "and",
                "or",
            }:
                continue
            if len(token) > 1:
                tokens.append(token)
    return " ".join(dict.fromkeys(tokens))


def detect_modality(text: str) -> tuple[str, bool]:
    lower = text.lower()
    if PROHIBITION_RE.search(lower):
        return "prohibited", True
    if OPTIONAL_RE.search(lower) or re.search(
        r"\bno\s+(?:receipts?|approval|pre-approval|action)\s+(?:is|are)\s+"
        r"(?:required|necessary|needed)\b",
        lower,
    ):
        return "may", bool(NEGATION_RE.search(lower))
    if MUST_RE.search(lower):
        return "must", bool(NEGATION_RE.search(lower))
    if SHOULD_RE.search(lower):
        return "should", bool(NEGATION_RE.search(lower))
    if MAY_RE.search(lower):
        return "may", bool(NEGATION_RE.search(lower))
    return "informational", bool(NEGATION_RE.search(lower))


def extract_numeric_constraints(text: str) -> list[str]:
    found: list[tuple[int, str]] = []
    for pattern in (MONEY_RE, PERCENT_RE, LIMIT_RE, DURATION_RE, DATE_RE, RANGE_RE):
        for match in pattern.finditer(text):
            value = re.sub(r"\s+", " ", match.group(0)).strip(" ,.;")
            if value:
                found.append((match.start(), value))
    found.sort(key=lambda item: item[0])
    output: list[str] = []
    seen: set[str] = set()
    for _, value in found:
        key = value.lower()
        # Avoid emitting the bare duration twice when it appears inside a limit.
        if any(key in existing and key != existing for existing in seen):
            continue
        if key not in seen:
            seen.add(key)
            output.append(value)
    return output[:8]


def extract_conditions(text: str, sentence: Any | None = None) -> list[str]:
    candidates: list[str] = []
    for match in CONDITION_RE.finditer(text):
        clause = match.group(0).strip(" ,;")
        if clause:
            candidates.append(clause)
    if sentence is not None and hasattr(sentence, "root"):
        for token in sentence:
            if token.dep_ == "advcl":
                clause = " ".join(child.text for child in token.subtree if not child.is_punct)
                if clause:
                    candidates.append(clause)
            if token.dep_ == "mark" and token.head is not None:
                clause = " ".join(
                    child.text for child in token.head.subtree if not child.is_punct
                )
                if clause:
                    candidates.append(clause)
    output: list[str] = []
    seen: set[str] = set()
    for clause in candidates:
        clause = re.sub(r"\s+", " ", clause).strip(" ,;")
        key = clause.lower()
        if len(clause) >= 3 and key not in seen:
            seen.add(key)
            output.append(clause[:220])
    return output[:4]


def _confidence(modality: str, entity: str, numeric: list[str], conditions: list[str], text: str) -> float:
    score = 0.48
    if modality != "informational":
        score += 0.2
    if entity:
        score += 0.08
    if numeric:
        score += 0.08
    if conditions:
        score += 0.05
    if 30 <= len(text) <= 500:
        score += 0.05
    return round(min(0.97, score), 3)


def _claim_id(chunk_id: str, sentence: str, index: int) -> str:
    digest = hashlib.sha1(f"{chunk_id}|{index}|{sentence}".encode("utf-8")).hexdigest()[:18]
    return f"clm_{digest}"


def _is_heading_sentence(sentence: str) -> bool:
    stripped = sentence.strip()
    if HEADING_NUMBERED_LOCAL.match(stripped):
        return True
    return len(stripped.split()) <= 8 and stripped.isupper()


HEADING_NUMBERED_LOCAL = re.compile(
    r"^(?:section|article|part|chapter)\s+\d+(?:\.\d+)*[.:)]?\s+",
    re.I,
)


def _split_claim_clauses(text: str) -> list[str]:
    parts = re.split(r";\s+|,\s+(?:but|however|whereas|while)\s+", text)
    if len(parts) <= 1:
        return [text]
    output = [part.strip(" ,;") for part in parts if len(part.split()) >= 3]
    return output or [text]


def extract_claims(
    chunk_id: str,
    chunk_text: str,
    *,
    section_heading: str | None = None,
    max_claims: int | None = None,
) -> list[dict[str, Any]]:
    settings = get_settings()
    max_claims = max_claims or settings.max_claims_per_chunk
    heading = _clean_heading(section_heading)
    nlp = get_nlp()
    body = chunk_text
    if heading and "\n" in chunk_text:
        first_line, remainder = chunk_text.split("\n", 1)
        if first_line.strip().lower() == heading.lower() or first_line.strip().lower() == (
            section_heading or ""
        ).lower():
            body = remainder
    sentences = split_sentences(body)
    claims: list[dict[str, Any]] = []
    seen: set[str] = set()

    for index, sentence_text in enumerate(sentences):
        for clause_index, clause in enumerate(_split_claim_clauses(sentence_text)):
            text = clause.strip()
            if len(text) < 18 or len(text.split()) < 3:
                continue
            if TABLE_OF_CONTENTS_RE.search(text) or LEGAL_FRAGMENT_RE.match(text):
                continue
            if METADATA_ONLY_RE.match(text) and len(text.split()) <= 12:
                continue
            if _is_heading_sentence(text):
                continue

            doc_sentence = None
            if nlp is not None:
                try:
                    parsed = nlp(text)
                    if parsed and len(parsed) > 0:
                        doc_sentence = (
                            parsed[0].as_doc()
                            if len(parsed) == 1
                            else next(parsed.sents, None)
                        )
                except Exception:
                    doc_sentence = None

            modality, negation = detect_modality(text)
            subject, action, object_text = (
                _subject_of(doc_sentence) if doc_sentence is not None else ("", "", "")
            )
            if not subject:
                # Conservative fallback: first noun-ish phrase before the first modal.
                match = re.match(
                    r"^([A-Z][^,.;]{2,80}?)\s+(?:must|shall|may|should|is|are|will|cannot|can)\b",
                    text,
                )
                if match:
                    subject = match.group(1)
            entity = heading or subject or "General policy"
            entity = re.sub(r"\s+", " ", entity).strip(" ,.;:")
            if len(entity) > 160:
                entity = entity[:157] + "…"
            numeric = extract_numeric_constraints(text)
            conditions = extract_conditions(text, doc_sentence)
            raw_key = text.lower()
            if raw_key in seen:
                continue
            if modality == "informational" and not numeric and not conditions:
                # Narrative filler is not useful evidence for the consistency engine.
                if len(text.split()) < 8:
                    continue
            seen.add(raw_key)
            confidence = _confidence(modality, entity, numeric, conditions, text)
            claims.append(
                {
                    "claim_id": _claim_id(chunk_id, text, index * 10 + clause_index),
                    "chunk_id": chunk_id,
                    "entity": entity,
                    "entity_key": _entity_key(heading, subject, object_text),
                    "subject": subject,
                    "action": action or "",
                    "object": object_text or "",
                    "modality": modality,
                    "negation": negation,
                    "numeric_constraints": numeric,
                    "conditions": conditions,
                    "raw_text": text,
                    "confidence": confidence,
                }
            )
            if len(claims) >= max_claims:
                return claims
    return claims


def enrich_claim(row: dict[str, Any]) -> dict[str, Any]:
    """Add source metadata expected by the API and reviewer UI."""
    return {
        "claim_id": row["claim_id"],
        "chunk_id": row["chunk_id"],
        "document_id": row.get("document_id", ""),
        "entity": row.get("entity", ""),
        "entity_key": row.get("entity_key", ""),
        "subject": row.get("subject", ""),
        "action": row.get("action", ""),
        "object": row.get("object", ""),
        "modality": row.get("modality", "informational"),
        "negation": bool(row.get("negation")),
        "numeric_constraints": row.get("numeric_constraints") or [],
        "conditions": row.get("conditions") or [],
        "raw_text": row.get("raw_text") or row.get("chunk_text", ""),
        "confidence": float(row.get("confidence", 0.5)),
        "source_filename": row.get("filename", ""),
        "page_number": int(row.get("page_number", 1) or 1),
        "section_heading": row.get("section_heading"),
        "doc_date": row.get("doc_date"),
        "uploaded_at": row.get("uploaded_at"),
        "version": int(row.get("version", 1) or 1),
    }
