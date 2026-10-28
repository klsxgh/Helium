"""Grounded answer synthesis and explanation formatting.

The default generator is a deterministic extractive synthesizer: every sentence
is backed by a retrieved passage, so an answer can never silently drift from the
source. An optional local HuggingFace model can be enabled for more natural
prose, with an extractive fallback if the model or hardware is unavailable.
"""

from __future__ import annotations

import logging
import re
import threading
import time
from typing import Any

from ..config import get_settings
from ..utils import tokenize, truncate

logger = logging.getLogger("helium.generator")

STOP = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "can",
    "could",
    "do",
    "does",
    "for",
    "from",
    "how",
    "i",
    "in",
    "is",
    "it",
    "may",
    "must",
    "my",
    "of",
    "on",
    "or",
    "our",
    "should",
    "that",
    "the",
    "their",
    "to",
    "was",
    "we",
    "what",
    "when",
    "where",
    "which",
    "who",
    "will",
    "with",
    "would",
    "you",
    "your",
    "about",
    "according",
    "policy",
    "policies",
    "document",
    "documents",
}

RELATIONSHIP_LABEL = {
    "agreement": "Agreement",
    "contradiction": "Direct contradiction",
    "conditional_conflict": "Conditional conflict",
    "equivalence": "Equivalence",
    "ambiguity": "Ambiguity",
}


def build_citations(chunks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    citations: list[dict[str, Any]] = []
    for index, chunk in enumerate(chunks, start=1):
        citations.append(
            {
                "label": f"S{index}",
                "chunk_id": chunk["id"],
                "filename": chunk.get("filename", "source"),
                "page_number": int(chunk.get("page_number", 1) or 1),
                "section_heading": chunk.get("section_heading"),
                "quote": truncate(re.sub(r"\s+", " ", chunk.get("text", "")).strip(), 1200),
                "score": round(float(chunk.get("retrieval_score", 0.0)), 4),
            }
        )
    return citations


def _query_tokens(query: str) -> set[str]:
    return {token for token in tokenize(query) if token not in STOP and len(token) > 2}


def _relevance(claim: dict[str, Any], query_tokens: set[str], rank: int) -> float:
    claim_tokens = set(tokenize(f"{claim.get('entity', '')} {claim.get('raw_text', '')}"))
    overlap = len(query_tokens & claim_tokens)
    score = overlap / max(1, len(query_tokens))
    if claim.get("entity", "").lower() in query_tokens:
        score += 0.15
    score += max(0.0, 0.18 - rank * 0.02)
    score += float(claim.get("confidence", 0.5)) * 0.08
    return round(score, 4)


def _citation_for(claim: dict[str, Any], citations: list[dict[str, Any]]) -> str | None:
    for citation in citations:
        if citation["chunk_id"] == claim.get("chunk_id"):
            return citation["label"]
    return None


def _citation_link(label: str | None, claim: dict[str, Any]) -> str:
    if not label:
        return ""
    return f"[[{label}]](citation:{claim.get('chunk_id', '')})"


def _snippet(claim: dict[str, Any], limit: int = 220) -> str:
    text = re.sub(r"\s+", " ", claim.get("raw_text", "")).strip()
    return truncate(text, limit)


def _health_label(score: int) -> str:
    if score >= 85:
        return "consistent"
    if score >= 70:
        return "mostly consistent"
    if score >= 50:
        return "needs review"
    return "conflicting"


def _group_issue_counts(conflicts: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for conflict in conflicts:
        relationship = conflict.get("relationship", "ambiguity")
        counts[relationship] = counts.get(relationship, 0) + 1
    return counts


def _select_evidence(
    claims: list[dict[str, Any]],
    query: str,
    citations: list[dict[str, Any]],
    limit: int = 5,
) -> list[dict[str, Any]]:
    query_tokens = _query_tokens(query)
    labels = {citation["chunk_id"]: index for index, citation in enumerate(citations)}
    ranked = sorted(
        claims,
        key=lambda claim: (
            _relevance(claim, query_tokens, labels.get(claim.get("chunk_id"), 10)),
            -labels.get(claim.get("chunk_id"), 10),
            claim.get("confidence", 0),
        ),
        reverse=True,
    )
    selected: list[dict[str, Any]] = []
    used_chunks: set[str] = set()

    def overlap(claim: dict[str, Any]) -> int:
        tokens = set(tokenize(f"{claim.get('entity', '')} {claim.get('raw_text', '')}"))
        return len(query_tokens & tokens)

    on_topic = [claim for claim in ranked if overlap(claim) or claim.get("entity", "").lower() in query_tokens]
    candidates = on_topic if len(on_topic) >= 2 else ranked

    for claim in candidates:
        if claim.get("modality") == "informational" and len(selected) >= 3:
            continue
        if claim.get("chunk_id") in used_chunks and len(selected) < limit:
            continue
        selected.append(claim)
        used_chunks.add(claim.get("chunk_id", ""))
        if len(selected) >= limit:
            break
    if not selected:
        selected = ranked[:limit]
    return selected


def _conflict_sentence(conflict: dict[str, Any], citations: list[dict[str, Any]]) -> str:
    a = conflict["claim_a"]
    b = conflict["claim_b"]
    label = RELATIONSHIP_LABEL.get(conflict.get("relationship"), "Relationship")
    link_a = _citation_link(_citation_for(a, citations), a)
    link_b = _citation_link(_citation_for(b, citations), b)
    return (
        f"- **{label}** — **{a.get('source_filename')}** says “{_snippet(a, 150)}” {link_a}, "
        f"while **{b.get('source_filename')}** says “{_snippet(b, 150)}” {link_b}. "
        f"{conflict.get('explanation', '').split(' Helium classifies')[0]}"
    )


def _extractive_answer(
    query: str,
    claims: list[dict[str, Any]],
    conflicts: list[dict[str, Any]],
    citations: list[dict[str, Any]],
    consistency_score: int,
    chunks_analyzed: int,
) -> str:
    if not claims:
        return (
            "### No grounded evidence found\n\n"
            "Helium did not find a passage in the indexed corpus that is specific enough to answer "
            "this question. Try adding a relevant policy document or rephrasing the query with the "
            "policy name, benefit, or process you are asking about.\n\n"
            "> No answer was invented outside the retrieved evidence."
        )

    evidence = _select_evidence(claims, query, citations)
    issue_counts = _group_issue_counts(conflicts)
    direct = issue_counts.get("contradiction", 0)
    conditional = issue_counts.get("conditional_conflict", 0)
    ambiguous = issue_counts.get("ambiguity", 0)
    health = _health_label(consistency_score)

    if direct or conditional:
        lead_a = evidence[0]
        conflicting = next(
            (
                conflict
                for conflict in conflicts
                if conflict["relationship"] in {"contradiction", "conditional_conflict"}
                and conflict["claim_a"]["chunk_id"] == lead_a["chunk_id"]
            ),
            next(
                (
                    conflict
                    for conflict in conflicts
                    if conflict["relationship"] in {"contradiction", "conditional_conflict"}
                ),
                None,
            ),
        )
        if conflicting:
            a, b = conflicting["claim_a"], conflicting["claim_b"]
            first_link = _citation_link(_citation_for(a, citations), a)
            second_link = _citation_link(_citation_for(b, citations), b)
            direct_answer = (
                "The documents do not give one consistent answer. "
                f"**{a.get('source_filename')}** states “{_snippet(a, 210)}” {first_link}, "
                f"but **{b.get('source_filename')}** states “{_snippet(b, 210)}” {second_link}. "
                "The contradiction affects the guidance below and should be resolved against the "
                "authoritative policy version before it is relied on."
            )
        else:
            direct_answer = (
                "Retrieved passages address the question, but they contain inconsistent guidance. "
                "Review the evidence and conflict checks below before acting."
            )
        warning = (
            f"> **Consistency health: {consistency_score}% ({health}).** "
            f"Helium analyzed {chunks_analyzed} retrieved chunks and found "
            f"**{direct} direct contradiction(s)**"
            + (f", **{conditional} conditional conflict(s)**" if conditional else "")
            + (f", and **{ambiguous} ambiguous pair(s)**" if ambiguous else "")
            + "."
        )
    else:
        first = evidence[0]
        first_link = _citation_link(_citation_for(first, citations), first)
        direct_answer = (
            f"Across the retrieved corpus, the guidance is {health}. "
            f"The clearest relevant statement is from **{first.get('source_filename')}**, "
            f"page {first.get('page_number')}: “{_snippet(first, 240)}” {first_link}. "
            + (
                "The other retrieved passages are consistent with this rule."
                if len(evidence) > 1
                else "No conflicting passage was found for this topic."
            )
        )
        warning = (
            f"> **Consistency health: {consistency_score}% ({health}).** "
            f"Helium analyzed {chunks_analyzed} retrieved chunks and found no material conflict "
            "for this query."
        )

    lines = ["### Direct answer", "", direct_answer, "", warning, "", "### Grounded evidence", ""]
    for claim in evidence:
        link = _citation_link(_citation_for(claim, citations), claim)
        location = f"p.{claim.get('page_number', 1)}"
        lines.append(
            f"- “{_snippet(claim)}” — **{claim.get('source_filename')}**, {location} {link}"
        )

    if conflicts:
        priority = sorted(
            conflicts,
            key=lambda item: (
                0 if item.get("relationship") == "contradiction" else 1,
                {"critical": 0, "high": 1, "medium": 2, "low": 3}.get(item.get("severity"), 4),
            ),
        )
        lines.extend(["", "### Why the sources disagree", ""])
        for conflict in priority[:3]:
            lines.append(_conflict_sentence(conflict, citations))
        if len(conflicts) > 3:
            lines.append(
                f"- **+{len(conflicts) - 3} more issue(s)** are available in the Consistency Inspector."
            )

    lines.extend(
        [
            "",
            "### Reviewer note",
            "",
            (
                "Use the consistency report to choose the controlling source, then record the "
                "decision. Helium's override actions never rewrite or alter the underlying uploaded "
                "documents."
                if conflicts
                else "No reviewer action is required for the relationship checks in this answer."
            ),
        ]
    )
    return "\n".join(lines)


class LocalLLM:
    """Lazily loaded local HuggingFace causal LM. Entirely optional."""

    _lock = threading.Lock()
    _instance: "LocalLLM | None" = None

    def __init__(self):
        settings = get_settings()
        from transformers import AutoModelForCausalLM, AutoTokenizer  # type: ignore
        import torch  # type: ignore

        self.tokenizer = AutoTokenizer.from_pretrained(settings.llm_model)
        dtype = torch.float32
        if settings.llm_device.startswith("cuda"):
            dtype = torch.float16
        self.model = AutoModelForCausalLM.from_pretrained(
            settings.llm_model,
            torch_dtype=dtype,
            low_cpu_mem_usage=True,
        )
        self.model.to(settings.llm_device)
        self.model.eval()
        self.settings = settings
        self.name = settings.llm_model

    @classmethod
    def get(cls) -> "LocalLLM":
        with cls._lock:
            if cls._instance is None:
                cls._instance = cls()
            return cls._instance

    def generate(self, prompt: str) -> str:
        import torch  # type: ignore

        messages = [
            {
                "role": "system",
                "content": (
                    "You are Helium, a strict evidence-grounded policy assistant. Answer only from "
                    "the supplied sources. Never invent a citation. Keep citations such as [S1]. "
                    "If sources conflict, state the conflict explicitly and do not choose a winner."
                ),
            },
            {"role": "user", "content": prompt},
        ]
        if hasattr(self.tokenizer, "apply_chat_template"):
            formatted = self.tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )
        else:
            formatted = prompt
        inputs = self.tokenizer(formatted, return_tensors="pt").to(self.settings.llm_device)
        with torch.no_grad():
            output = self.model.generate(
                **inputs,
                max_new_tokens=self.settings.llm_max_new_tokens,
                do_sample=self.settings.llm_temperature > 0,
                temperature=max(0.01, self.settings.llm_temperature),
                pad_token_id=self.tokenizer.eos_token_id,
            )
        generated = self.tokenizer.decode(
            output[0][inputs["input_ids"].shape[-1] :], skip_special_tokens=True
        )
        return generated.strip()


def _llm_answer(
    query: str,
    conflicts: list[dict[str, Any]],
    citations: list[dict[str, Any]],
    fallback: str,
) -> str:
    source_block = "\n\n".join(
        f"[{citation['label']}] {citation['filename']}, page {citation['page_number']}"
        f"{', ' + citation['section_heading'] if citation.get('section_heading') else ''}\n"
        f"{citation['quote']}"
        for citation in citations
    )
    conflict_block = "\n".join(
        f"- {RELATIONSHIP_LABEL.get(item['relationship'], item['relationship'])}: "
        f"{item['explanation']}"
        for item in conflicts
    ) or "- No conflicts detected."
    prompt = (
        f"Question: {query}\n\nRetrieved sources:\n{source_block}\n\n"
        f"Contradiction analysis:\n{conflict_block}\n\n"
        "Write a concise Markdown answer. Begin with '### Direct answer'. Cite every factual "
        "sentence with [S1]-style tags. Explicitly surface contradictions and do not average "
        "conflicting guidance."
    )
    try:
        answer = LocalLLM.get().generate(prompt)
    except Exception as exc:
        logger.warning("Local LLM unavailable, using extractive synthesis: %s", exc)
        return fallback
    if not answer or len(answer) < 40:
        return fallback
    citation_by_label = {citation["label"]: citation for citation in citations}
    for label, citation in citation_by_label.items():
        answer = re.sub(
            rf"(?<!\[)\[{label}\](?!\])",
            f"[[{label}]](citation:{citation['chunk_id']})",
            answer,
        )
    if "Direct answer" not in answer:
        answer = f"### Direct answer\n\n{answer}"
    return answer


def generate_answer(
    *,
    query: str,
    claims: list[dict[str, Any]],
    conflicts: list[dict[str, Any]],
    citations: list[dict[str, Any]],
    consistency_score: int,
    chunks_analyzed: int,
) -> tuple[str, str]:
    started = time.perf_counter()
    fallback = _extractive_answer(
        query, claims, conflicts, citations, consistency_score, chunks_analyzed
    )
    settings = get_settings()
    backend = "extractive"
    answer = fallback
    if settings.llm_enabled and citations:
        candidate = _llm_answer(query, conflicts, citations, fallback)
        if candidate != fallback:
            answer = candidate
            backend = f"local:{settings.llm_model}"
    logger.debug("Answer generated in %.1fms", (time.perf_counter() - started) * 1000)
    return answer, backend
