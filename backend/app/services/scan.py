"""Cross-document contradiction scan.

A query retrieves the passages that best match a question and analyses those. A
scan deliberately works the other way round: the caller selects whole documents,
every extracted claim from those documents is compared with the claims of the
other selected documents, and only cross-file pairs are reported. That makes the
result a direct document-vs-document consistency check with no question needed.
"""

from __future__ import annotations

import time
from typing import Any

from ..db import Repository, get_repository
from ..utils import new_id, utc_now
from .rag import _dedupe_claims
from .reasoning import analyze_claims


def _summary(counts: dict[str, int], documents: int) -> str:
    issues = (
        counts.get("contradiction", 0)
        + counts.get("conditional_conflict", 0)
        + counts.get("ambiguity", 0)
    )
    return (
        f"Cross-document scan of {documents} sources found {issues} issue"
        f"{'' if issues == 1 else 's'}: {counts.get('contradiction', 0)} direct "
        f"contradiction(s), {counts.get('conditional_conflict', 0)} conditional "
        f"conflict(s), and {counts.get('ambiguity', 0)} ambiguity(ies)."
    )


def scan_documents(
    document_ids: list[str],
    *,
    uid: str | None = None,
    repository: Repository | None = None,
) -> dict[str, Any]:
    """Compare every claim in the selected documents against the other files."""

    repository = repository or get_repository(uid)
    unique_ids = list(dict.fromkeys(document_ids))
    if len(unique_ids) < 2:
        raise ValueError("Select at least two documents to compare.")

    documents: list[dict[str, Any]] = []
    for document_id in unique_ids:
        document = repository.get_document(document_id)
        if not document:
            raise ValueError("One of the selected documents no longer exists.")
        if document["status"] != "ready":
            raise ValueError(f"{document['filename']} is still indexing. Try again shortly.")
        documents.append(document)

    started = time.perf_counter()
    chunks: list[dict[str, Any]] = []
    for document in documents:
        chunks.extend(repository.list_chunks(document["id"]))
    chunk_ids = [chunk["id"] for chunk in chunks]
    claims = _dedupe_claims(repository.get_claims_for_chunks(chunk_ids))

    reasoning = analyze_claims(claims, cross_document_only=True)
    elapsed_ms = (time.perf_counter() - started) * 1000

    scan_id = new_id("scan")
    created_at = utc_now()
    names = [document["filename"] for document in documents]
    title = "Cross-document scan · " + ", ".join(names)
    metrics = {
        "scan_ms": round(elapsed_ms, 1),
        "documents": len(documents),
        "document_ids": [document["id"] for document in documents],
        "document_names": names,
        "chunks": len(chunks),
        "claims_analyzed": reasoning.claims_analyzed,
        "pairs_analyzed": reasoning.pairs_analyzed,
        "relationship_counts": reasoning.counts,
    }

    for relationship in reasoning.relationships:
        relationship["query_id"] = scan_id
        relationship["created_at"] = created_at

    repository.save_query(
        query_id=scan_id,
        query=title,
        answer=_summary(reasoning.counts, len(documents)),
        citations=[],
        claims=claims,
        metrics=metrics,
        consistency_score=reasoning.consistency_score,
        chunks_analyzed=len(chunks),
        top_k=0,
        sources=[],
        conflicts=reasoning.relationships,
        kind="scan",
    )

    return {
        "scan_id": scan_id,
        "query": title,
        "document_ids": metrics["document_ids"],
        "document_names": names,
        "relationships": reasoning.relationships,
        "conflicts": reasoning.conflicts,
        "counts": reasoning.counts,
        "claims_analyzed": reasoning.claims_analyzed,
        "pairs_analyzed": reasoning.pairs_analyzed,
        "chunks_analyzed": len(chunks),
        "consistency_score": reasoning.consistency_score,
        "created_at": created_at,
        "metrics": metrics,
    }


def get_scan_result(
    scan_id: str, *, uid: str | None = None, repository: Repository | None = None
) -> dict[str, Any] | None:
    repository = repository or get_repository(uid)
    row = repository.get_query(scan_id)
    if not row or row.get("kind") != "scan":
        return None
    metrics = row.get("metrics", {})
    relationships = row.get("conflicts", [])
    counts = metrics.get("relationship_counts", {})
    issues = {
        "contradiction",
        "conditional_conflict",
        "ambiguity",
    }
    return {
        "scan_id": row["id"],
        "query": row["query"],
        "document_ids": metrics.get("document_ids", []),
        "document_names": metrics.get("document_names", []),
        "relationships": relationships,
        "conflicts": [
            item for item in relationships if item.get("relationship") in issues
        ],
        "counts": counts,
        "claims_analyzed": int(metrics.get("claims_analyzed", 0)),
        "pairs_analyzed": int(metrics.get("pairs_analyzed", 0)),
        "chunks_analyzed": int(row.get("chunks_analyzed", 0)),
        "consistency_score": int(row.get("consistency_score", 100)),
        "created_at": row.get("created_at", ""),
        "metrics": metrics,
    }
