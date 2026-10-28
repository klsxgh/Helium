"""Pairwise claim reasoning and consistency scoring.

The engine is intentionally rule-guided and explainable: every relationship is
backed by concrete mismatches (modality, negation, numerics, conditions, or
temporal revision) rather than an opaque similarity score. An optional language
model is used later for synthesis, never for deciding truth.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Any, Iterable

from ..utils import new_id, tokenize
from .extractor import enrich_claim

STOP = {
    "a",
    "an",
    "the",
    "and",
    "or",
    "but",
    "if",
    "then",
    "than",
    "that",
    "this",
    "these",
    "those",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "to",
    "of",
    "in",
    "on",
    "at",
    "for",
    "from",
    "with",
    "by",
    "as",
    "it",
    "its",
    "their",
    "our",
    "we",
    "you",
    "they",
    "he",
    "she",
    "all",
    "any",
    "each",
    "employee",
    "employees",
    "staff",
    "person",
    "people",
    "policy",
    "policies",
    "company",
    "organization",
    "organisation",
    "document",
    "documents",
    "must",
    "shall",
    "should",
    "may",
    "can",
    "will",
    "would",
    "could",
    "required",
    "require",
    "requires",
    "requirement",
    "mandatory",
    "optional",
    "permitted",
    "allowed",
    "prohibited",
    "not",
    "no",
    "never",
    "per",
    "under",
    "over",
    "least",
    "most",
    "more",
    "less",
    "within",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "also",
    "only",
    "such",
    "other",
    "same",
    "any",
}

SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
ISSUE_RELATIONSHIPS = {"contradiction", "conditional_conflict", "ambiguity"}


@dataclass
class ReasoningResult:
    relationships: list[dict[str, Any]] = field(default_factory=list)
    conflicts: list[dict[str, Any]] = field(default_factory=list)
    consistency_score: int = 100
    counts: dict[str, int] = field(default_factory=dict)
    pairs_analyzed: int = 0
    claims_analyzed: int = 0


def _jaccard(left: set[str], right: set[str]) -> float:
    if not left or not right:
        return 0.0
    return len(left & right) / len(left | right)


def _seq_similarity(left: str, right: str) -> float:
    if not left or not right:
        return 0.0
    return SequenceMatcher(None, left, right).ratio()


def _content_tokens(text: str) -> set[str]:
    return {_stem(token) for token in tokenize(text) if token not in STOP and len(token) > 2}


def _stem(token: str) -> str:
    if len(token) > 5 and token.endswith("ing"):
        token = token[:-3]
    elif len(token) > 4 and token.endswith("ed"):
        token = token[:-2]
    elif len(token) > 4 and token.endswith("es"):
        token = token[:-2]
    elif len(token) > 3 and token.endswith("s") and not token.endswith("ss"):
        token = token[:-1]
    return token


def _topic_profile(claim: dict[str, Any]) -> dict[str, Any]:
    heading_tokens = _content_tokens(
        f"{claim.get('section_heading', '')} {claim.get('entity', '')}"
    )
    entity_tokens = _content_tokens(
        f"{claim.get('entity', '')} {claim.get('action', '')} {claim.get('object', '')}"
    )
    all_topic_tokens = _content_tokens(
        f"{claim.get('entity', '')} {claim.get('action', '')} "
        f"{claim.get('object', '')} {claim.get('raw_text', '')}"
    )
    focus_tokens = all_topic_tokens - heading_tokens
    return {
        "entity_tokens": entity_tokens,
        "topic_tokens": all_topic_tokens,
        "heading_tokens": heading_tokens,
        "focus_tokens": focus_tokens,
        "normalized_text": " ".join(sorted(all_topic_tokens)),
    }


def _topic_similarity(a: dict[str, Any], b: dict[str, Any]) -> float:
    entity_jaccard = _jaccard(a["entity_tokens"], b["entity_tokens"])
    raw_jaccard = _jaccard(a["topic_tokens"], b["topic_tokens"])
    heading_jaccard = _jaccard(a["heading_tokens"], b["heading_tokens"])
    focus_jaccard = _jaccard(a["focus_tokens"], b["focus_tokens"])
    text_seq = _seq_similarity(a["normalized_text"], b["normalized_text"])
    return round(
        0.28 * entity_jaccard
        + 0.20 * raw_jaccard
        + 0.18 * heading_jaccard
        + 0.20 * focus_jaccard
        + 0.14 * text_seq,
        4,
    )


def _focus_similarity(a: dict[str, Any], b: dict[str, Any]) -> tuple[float, float, int]:
    left = a["focus_tokens"]
    right = b["focus_tokens"]
    intersection = len(left & right)
    if not left or not right:
        return 0.0, 0.0, 0
    jaccard = intersection / len(left | right)
    overlap = intersection / min(len(left), len(right))
    return jaccard, overlap, intersection


def _is_related(
    similarity: float, a: dict[str, Any], b: dict[str, Any]
) -> bool:
    focus_jaccard, focus_overlap, focus_intersection = _focus_similarity(a, b)
    raw_jaccard = _jaccard(a["topic_tokens"], b["topic_tokens"])
    # The subject/object focus is the strongest guard against false positives
    # under a shared section heading. Two clauses from "Remote Work Policy" are
    # not comparable just because the heading matches.
    if focus_jaccard >= 0.17 and (similarity >= 0.27 or raw_jaccard >= 0.16):
        return True
    if focus_intersection >= 2 and focus_overlap >= 0.45 and similarity >= 0.30:
        return True
    if raw_jaccard >= 0.36 and similarity >= 0.30:
        return True
    return False


DURATION_RE = re.compile(
    r"(\d+(?:\.\d+)?)\s*(business\s+|calendar\s+|working\s+)?"
    r"(days?|weeks?|months?|years?|hours?|minutes?)",
    re.I,
)
MONEY_RE = re.compile(r"(?:US\$|USD|\$)\s?(\d[\d,]*(?:\.\d+)?)", re.I)
PERCENT_RE = re.compile(r"(\d+(?:\.\d+)?)\s?%")
DATE_RE = re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")
MONTH_DATE_RE = re.compile(
    r"\b(January|February|March|April|May|June|July|August|September|October|November|December|"
    r"Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(\d{4})\b",
    re.I,
)
GENERIC_NUMBER_RE = re.compile(r"\b(\d+(?:\.\d+)?)\b")
MONTHS = {
    "january": 1,
    "jan": 1,
    "february": 2,
    "feb": 2,
    "march": 3,
    "mar": 3,
    "april": 4,
    "apr": 4,
    "may": 5,
    "june": 6,
    "jun": 6,
    "july": 7,
    "jul": 7,
    "august": 8,
    "aug": 8,
    "september": 9,
    "sep": 9,
    "sept": 9,
    "october": 10,
    "oct": 10,
    "november": 11,
    "nov": 11,
    "december": 12,
    "dec": 12,
}


def _normalize_number(raw: str) -> float | None:
    try:
        return float(raw.replace(",", ""))
    except ValueError:
        return None


def _numeric_signature(values: Iterable[str]) -> dict[str, set[float]]:
    signature: dict[str, set[float]] = {}
    for value in values:
        text = str(value)
        money = MONEY_RE.search(text)
        if money and (number := _normalize_number(money.group(1))) is not None:
            signature.setdefault("money", set()).add(number)
        percent = PERCENT_RE.search(text)
        if percent and (number := _normalize_number(percent.group(1))) is not None:
            signature.setdefault("percent", set()).add(number)
        date = DATE_RE.search(text)
        if date:
            signature.setdefault("date", set()).add(float(date.group(1).replace("-", "")))
        month_date = MONTH_DATE_RE.search(text)
        if month_date:
            month = MONTHS.get(month_date.group(1).lower())
            if month:
                signature.setdefault("date", set()).add(
                    float(f"{month_date.group(3)}{month:02d}{int(month_date.group(2)):02d}")
                )
        duration = DURATION_RE.search(text)
        if duration and (number := _normalize_number(duration.group(1))) is not None:
            unit = duration.group(3).lower()
            if unit.startswith("week"):
                number *= 7
                unit = "days"
            elif unit.startswith("hour"):
                unit = "hours"
            elif unit.startswith("minute"):
                unit = "minutes"
            elif unit.startswith("month"):
                unit = "months"
            elif unit.startswith("year"):
                unit = "years"
            else:
                unit = "days"
            signature.setdefault(unit, set()).add(number)
        # Avoid double counting amounts or percentages as generic counts.
        if money or percent:
            continue
        if not date and not month_date and not duration:
            generic = GENERIC_NUMBER_RE.search(text)
            if generic and (number := _normalize_number(generic.group(1))) is not None:
                signature.setdefault("count", set()).add(number)
    return signature


def _numeric_mismatches(
    a: dict[str, Any], b: dict[str, Any]
) -> list[dict[str, Any]]:
    sig_a = _numeric_signature(a.get("numeric_constraints", []))
    sig_b = _numeric_signature(b.get("numeric_constraints", []))
    mismatches: list[dict[str, Any]] = []
    for category in set(sig_a) & set(sig_b):
        if sig_a[category] != sig_b[category]:
            mismatches.append(
                {
                    "field": "numeric",
                    "detail": f"Numeric {category} constraints differ: "
                    f"{', '.join(a.get('numeric_constraints', [])) or 'none'} vs "
                    f"{', '.join(b.get('numeric_constraints', [])) or 'none'}.",
                    "claim_a": a.get("numeric_constraints", []),
                    "claim_b": b.get("numeric_constraints", []),
                }
            )
    return mismatches


def _subject_compatible(a: dict[str, Any], b: dict[str, Any]) -> bool:
    subject_a = str(a.get("subject") or "").strip()
    subject_b = str(b.get("subject") or "").strip()
    if not subject_a or not subject_b:
        return True
    generic = {"employees", "employee", "staff", "all employees", "personnel", "person"}
    if subject_a.lower() in generic or subject_b.lower() in generic:
        return True
    clean_a = re.sub(r"[$€£]?\d[\d,.]*", " ", subject_a)
    clean_b = re.sub(r"[$€£]?\d[\d,.]*", " ", subject_b)
    function_words = {
        "the",
        "a",
        "an",
        "all",
        "other",
        "of",
        "for",
        "to",
        "in",
        "on",
        "and",
        "or",
        "above",
        "below",
        "under",
        "over",
        "including",
        "any",
        "each",
    }
    tokens_a = {
        _stem(token)
        for token in tokenize(clean_a.lower())
        if token not in function_words and len(token) > 1
    }
    tokens_b = {
        _stem(token)
        for token in tokenize(clean_b.lower())
        if token not in function_words and len(token) > 1
    }
    if not tokens_a or not tokens_b:
        return True
    return _jaccard(tokens_a, tokens_b) >= 0.60


def _condition_tokens(claim: dict[str, Any]) -> set[str]:
    text = " ".join(claim.get("conditions", []))
    return _content_tokens(re.sub(r"^(?:if|when|whenever|unless|provided that)\b", "", text, flags=re.I))


def _condition_mismatch(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any] | None:
    cond_a = [str(item).strip() for item in a.get("conditions", []) if str(item).strip()]
    cond_b = [str(item).strip() for item in b.get("conditions", []) if str(item).strip()]
    if not cond_a and not cond_b:
        return None
    if bool(cond_a) != bool(cond_b):
        return {
            "field": "condition",
            "detail": "One rule has a conditional/exception scope while the other is stated universally.",
            "claim_a": cond_a,
            "claim_b": cond_b,
        }
    tokens_a = _condition_tokens(a)
    tokens_b = _condition_tokens(b)
    if not tokens_a or not tokens_b or _jaccard(tokens_a, tokens_b) < 0.55:
        return {
            "field": "condition",
            "detail": "The rules apply under different conditions or populations.",
            "claim_a": cond_a,
            "claim_b": cond_b,
        }
    return None


def _date_value(claim: dict[str, Any]) -> str | None:
    # Only an inferred effective/revision date is semantically meaningful. The
    # ingestion timestamp is deliberately excluded: two files uploaded seconds
    # apart are not different policy revisions.
    value = claim.get("doc_date")
    if not value:
        return None
    return str(value)[:10]


def _temporal_mismatch(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any] | None:
    date_a = _date_value(a)
    date_b = _date_value(b)
    if not date_a or not date_b or date_a == date_b:
        return None
    newer, older = (a, b) if date_a > date_b else (b, a)
    return {
        "field": "temporal",
        "detail": (
            f"The documents carry different effective/version dates ({date_a} vs {date_b}). "
            f"{newer.get('source_filename')} appears newer and may supersede "
            f"{older.get('source_filename')}."
        ),
        "claim_a": date_a,
        "claim_b": date_b,
    }


def _modality_conflict(a: str, b: str) -> bool:
    pair = {a, b}
    if a == b:
        return False
    if pair == {"must", "may"}:
        return True
    if "prohibited" in pair:
        return True
    if "informational" in pair:
        return False
    return False


def _weak_modality(a: str, b: str) -> bool:
    return {a, b} in ({"must", "should"}, {"should", "may"}, {"should", "informational"})


def _source_phrase(claim: dict[str, Any], include_page: bool = True) -> str:
    filename = claim.get("source_filename") or "source"
    if not include_page:
        return filename
    page = claim.get("page_number")
    section = claim.get("section_heading")
    if section:
        return f"{filename}, p.{page} ({section})"
    return f"{filename}, p.{page}"


def _quote(claim: dict[str, Any], limit: int = 260) -> str:
    text = re.sub(r"\s+", " ", claim.get("raw_text", "")).strip()
    if len(text) > limit:
        text = text[: limit - 1].rstrip() + "…"
    return text


def _explanation(
    relationship: str,
    a: dict[str, Any],
    b: dict[str, Any],
    mismatches: list[dict[str, Any]],
    similarity: float,
) -> str:
    source_a = _source_phrase(a)
    source_b = _source_phrase(b)
    quote_a = _quote(a)
    quote_b = _quote(b)
    entity = a.get("entity") or b.get("entity") or "the shared policy topic"
    fields = [m["field"] for m in mismatches]
    if relationship == "agreement":
        return (
            f"{source_a} and {source_b} align on **{entity}**. "
            f"No material difference was found in modality, negation, numeric limits, or scope. "
            f"Both support the same rule."
        )
    if relationship == "equivalence":
        return (
            f"{source_a} and {source_b} express the same rule in different words. "
            f"The modality, polarity, and constraints match, so these passages are **equivalent**."
        )
    if relationship == "ambiguity":
        detail = "; ".join(m["detail"] for m in mismatches) or (
            "the claims share a topic but their scope is not precise enough to determine agreement."
        )
        return (
            f"The relationship between {source_a} and {source_b} is **ambiguous** regarding "
            f"**{entity}**. {detail} The passages should be reviewed for clearer modal language."
        )

    reasons: list[str] = []
    for mismatch in mismatches:
        field = mismatch["field"]
        if field == "modality":
            reasons.append(
                f"modality differs (**{a.get('modality')}** vs **{b.get('modality')}**)"
            )
        elif field == "negation":
            reasons.append(
                f"one rule is negated while the other is not "
                f"(negation: {a.get('negation')} vs {b.get('negation')})"
            )
        elif field == "numeric":
            reasons.append(mismatch["detail"].rstrip("."))
        elif field == "condition":
            reasons.append("the conditions/scopes do not match")
        elif field == "temporal":
            continue
    reason_text = "; ".join(reasons) or "the claims place incompatible requirements on the same topic"
    label = "**direct contradiction**" if relationship == "contradiction" else "**conditional conflict**"
    intro = (
        f"{source_a} says: “{quote_a}” {source_b} says: “{quote_b}” "
        f"Helium classifies this as a {label} on **{entity}** because {reason_text}."
    )
    temporal = next((m for m in mismatches if m["field"] == "temporal"), None)
    if temporal:
        intro += f" {temporal['detail']}"
    return intro


def _confidence(
    similarity: float,
    mismatches: list[dict[str, Any]],
    a: dict[str, Any],
    b: dict[str, Any],
) -> float:
    base = 0.42 + 0.38 * similarity
    base += min(0.12, 0.035 * len(mismatches))
    base = (base + float(a.get("confidence", 0.5)) + float(b.get("confidence", 0.5))) / 1.45
    return round(max(0.35, min(0.98, base)), 3)


def _severity(relationship: str, a: dict[str, Any], b: dict[str, Any], mismatches: list[dict[str, Any]]) -> str:
    if relationship == "contradiction":
        pair = {a.get("modality"), b.get("modality")}
        if pair in ({"must", "prohibited"}, {"may", "prohibited"}):
            return "critical"
        return "high"
    if relationship == "conditional_conflict":
        return "high" if any(m["field"] in {"modality", "negation"} for m in mismatches) else "medium"
    if relationship == "ambiguity":
        return "medium" if any(m["field"] in {"modality", "condition", "numeric"} for m in mismatches) else "low"
    return "info"


def _classify(
    a: dict[str, Any],
    b: dict[str, Any],
    similarity: float,
) -> tuple[str, list[dict[str, Any]], str]:
    modality_a = a.get("modality", "informational")
    modality_b = b.get("modality", "informational")
    mismatches: list[dict[str, Any]] = []

    if modality_a != modality_b:
        mismatches.append(
            {
                "field": "modality",
                "detail": f"Prescriptive strength differs: {modality_a} vs {modality_b}.",
                "claim_a": modality_a,
                "claim_b": modality_b,
            }
        )
    if bool(a.get("negation")) != bool(b.get("negation")):
        mismatches.append(
            {
                "field": "negation",
                "detail": "One claim contains a negation/prohibition and the other does not.",
                "claim_a": bool(a.get("negation")),
                "claim_b": bool(b.get("negation")),
            }
        )
    numeric = _numeric_mismatches(a, b)
    mismatches.extend(numeric)
    condition = _condition_mismatch(a, b)
    if condition:
        mismatches.append(condition)
    temporal = _temporal_mismatch(a, b)
    if temporal:
        mismatches.append(temporal)

    modal_conflict = _modality_conflict(modality_a, modality_b)
    negation_conflict = bool(a.get("negation")) != bool(b.get("negation"))
    hard_numeric = bool(numeric)
    scoped = condition is not None
    subjects_differ = hard_numeric and not _subject_compatible(a, b)
    if subjects_differ:
        mismatches.append(
            {
                "field": "subject",
                "detail": (
                    f"The numerical limits attach to different subjects: "
                    f"“{a.get('subject') or a.get('entity')}” vs "
                    f"“{b.get('subject') or b.get('entity')}”."
                ),
                "claim_a": a.get("subject") or a.get("entity"),
                "claim_b": b.get("subject") or b.get("entity"),
            }
        )

    if modal_conflict or negation_conflict:
        if scoped:
            return "conditional_conflict", mismatches, "high"
        return "contradiction", mismatches, "critical" if {modality_a, modality_b} & {"prohibited"} else "high"

    if subjects_differ:
        return "ambiguity", mismatches, "low"

    if hard_numeric:
        if scoped:
            return "conditional_conflict", mismatches, "high"
        if modality_a in {"must", "prohibited", "should"} or modality_b in {"must", "prohibited", "should"}:
            return "contradiction", mismatches, "high"
        return "ambiguity", mismatches, "medium"

    if scoped and modality_a != modality_b:
        return "conditional_conflict", mismatches, "high"

    if _weak_modality(modality_a, modality_b):
        return "ambiguity", mismatches, "medium"

    if "informational" in {modality_a, modality_b} and modality_a != modality_b:
        return "ambiguity", mismatches, "low"

    if similarity >= 0.68:
        return "equivalence", mismatches, "info"
    return "agreement", mismatches, "info"


def analyze_claims(
    claims: Iterable[dict[str, Any]], *, cross_document_only: bool = False
) -> ReasoningResult:
    claim_list = [enrich_claim(claim) if "source_filename" not in claim else claim for claim in claims]
    profiles = {claim["claim_id"]: _topic_profile(claim) for claim in claim_list}
    relationships: list[dict[str, Any]] = []
    counts: dict[str, int] = {
        "agreement": 0,
        "contradiction": 0,
        "conditional_conflict": 0,
        "equivalence": 0,
        "ambiguity": 0,
    }
    pairs = 0
    seen_pairs: set[tuple[str, str]] = set()
    for index, a in enumerate(claim_list):
        for b in claim_list[index + 1 :]:
            if a["chunk_id"] == b["chunk_id"]:
                continue
            if cross_document_only and a.get("document_id") == b.get("document_id"):
                continue
            key = tuple(sorted((a["claim_id"], b["claim_id"])))
            if key in seen_pairs:
                continue
            seen_pairs.add(key)
            if a.get("raw_text", "").strip().lower() == b.get("raw_text", "").strip().lower():
                similarity = 1.0
            else:
                similarity = _topic_similarity(profiles[a["claim_id"]], profiles[b["claim_id"]])
            if not _is_related(
                similarity, profiles[a["claim_id"]], profiles[b["claim_id"]]
            ):
                continue
            # Cross-chunk checks inside the same source are allowed (a document
            # can contradict itself), but demand a tighter focus match.
            if a.get("document_id") and a.get("document_id") == b.get("document_id"):
                focus_jaccard, _, _ = _focus_similarity(
                    profiles[a["claim_id"]], profiles[b["claim_id"]]
                )
                if focus_jaccard < 0.30:
                    continue
            left, right = (b, a) if (
                (a.get("source_filename"), a.get("raw_text"))
                > (b.get("source_filename"), b.get("raw_text"))
            ) else (a, b)
            relationship, mismatches, severity = _classify(left, right, similarity)
            pairs += 1
            counts[relationship] = counts.get(relationship, 0) + 1
            relationship_id = new_id("rel")
            relationships.append(
                {
                    "id": relationship_id,
                    "relationship": relationship,
                    "severity": severity,
                    "confidence": _confidence(similarity, mismatches, left, right),
                    "explanation": _explanation(relationship, left, right, mismatches, similarity),
                    "mismatches": mismatches,
                    "claim_a": left,
                    "claim_b": right,
                    "status": "open",
                    "created_at": "",
                }
            )

    relationships.sort(
        key=lambda item: (
            SEVERITY_ORDER.get(item["severity"], 5),
            0 if item["relationship"] in ISSUE_RELATIONSHIPS else 1,
            -item["confidence"],
        )
    )
    conflicts = [
        relationship
        for relationship in relationships
        if relationship["relationship"] in ISSUE_RELATIONSHIPS
    ]
    total = sum(counts.values())
    if total:
        weighted = (
            counts["agreement"]
            + counts["equivalence"]
            + 0.45 * counts["ambiguity"]
            + 0.15 * counts["conditional_conflict"]
        ) / total
        consistency = int(round(max(0, min(100, weighted * 100))))
    else:
        consistency = 100
    return ReasoningResult(
        relationships=relationships,
        conflicts=conflicts,
        consistency_score=consistency,
        counts=counts,
        pairs_analyzed=pairs,
        claims_analyzed=len(claim_list),
    )
