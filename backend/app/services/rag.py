"""End-to-end retrieval, claim reasoning, and grounded generation pipeline."""

from __future__ import annotations

import logging
import re
import time
from typing import Any

from ..db import Repository, get_repository
from ..utils import new_id, utc_now
from .embedder import EmbeddingService, IndexManager, get_embedder, get_index
from .extractor import enrich_claim, extract_claims
from .generator import build_citations, generate_answer
from .reasoning import analyze_claims

logger = logging.getLogger("helium.rag")

QUERY_STOP = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "been",
    "by",
    "can",
    "could",
    "did",
    "do",
    "does",
    "for",
    "from",
    "had",
    "has",
    "have",
    "how",
    "i",
    "if",
    "in",
    "is",
    "it",
    "its",
    "may",
    "me",
    "must",
    "my",
    "need",
    "of",
    "on",
    "or",
    "our",
    "please",
    "policy",
    "policies",
    "should",
    "tell",
    "that",
    "the",
    "their",
    "there",
    "these",
    "they",
    "this",
    "to",
    "was",
    "we",
    "were",
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
    "according",
    "say",
    "says",
    "document",
    "documents",
}


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


def _query_scope_claims(query: str, claims: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep claims that actually address the question's focus.

    A retrieved section can contain receipts, meal caps, and travel approvals in
    one chunk. Comparing every clause in that chunk to every clause in another
    produces noisy "conflicts" that do not answer the query. Query-focus
    filtering keeps the consistency report relevant while a broad query (no
    content tokens) still analyzes every retrieved claim.
    """

    from ..utils import tokenize

    query_tokens = {
        _stem(token)
        for token in tokenize(query.lower())
        if token not in QUERY_STOP and len(token) > 2
    }
    if not query_tokens:
        return claims
    scored: list[tuple[int, dict[str, Any]]] = []
    for claim in claims:
        claim_tokens = {
            _stem(token)
            for token in tokenize(
                " ".join(
                    [
                        claim.get("entity", ""),
                        claim.get("subject", ""),
                        claim.get("action", ""),
                        claim.get("object", ""),
                        claim.get("raw_text", ""),
                    ]
                ).lower()
            )
            if len(token) > 2
        }
        scored.append((len(query_tokens & claim_tokens), claim))
    minimum = 2 if len(query_tokens) >= 3 else 1
    relevant = [claim for overlap, claim in scored if overlap >= minimum]
    if not relevant:
        relevant = [claim for overlap, claim in scored if overlap >= 1]
    return relevant or claims


def _dedupe_claims(claims: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Remove repeated sentences caused by overlapping chunks.

    Identical rules in different documents are intentionally preserved so they
    can be reported as equivalence or agreement.
    """

    output: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for claim in claims:
        key = (
            str(claim.get("document_id", "")),
            re.sub(r"\W+", " ", claim.get("raw_text", "").lower()).strip(),
        )
        if key in seen:
            continue
        seen.add(key)
        output.append(claim)
    return output


def _fallback_claims(chunks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    claims: list[dict[str, Any]] = []
    for chunk in chunks:
        extracted = extract_claims(
            chunk["id"],
            chunk["text"],
            section_heading=chunk.get("section_heading"),
        )
        for claim in extracted:
            claim.update(
                {
                    "document_id": chunk["document_id"],
                    "chunk_text": chunk["text"],
                    "filename": chunk["filename"],
                    "page_number": chunk["page_number"],
                    "section_heading": chunk.get("section_heading"),
                    "doc_date": chunk.get("doc_date"),
                    "uploaded_at": chunk.get("uploaded_at"),
                    "version": chunk.get("version", 1),
                }
            )
            claims.append(enrich_claim(claim))
    return claims


def _hydrate_result(row: dict[str, Any]) -> dict[str, Any]:
    relationships = row.get("conflicts", [])
    issues = [
        item
        for item in relationships
        if item.get("relationship") in {"contradiction", "conditional_conflict", "ambiguity"}
    ]
    return {
        "query_id": row["id"],
        "query": row["query"],
        "answer": row["answer"],
        "citations": row.get("citations", []),
        "claims": row.get("claims", []),
        "relationships": relationships,
        "conflicts": issues,
        "metrics": row.get("metrics", {}),
        "consistency_score": int(row.get("consistency_score", 100)),
        "chunks_analyzed": int(row.get("chunks_analyzed", 0)),
        "created_at": row.get("created_at", ""),
    }


def run_query(
    query: str,
    top_k: int = 8,
    *,
    uid: str | None = None,
    repository: Repository | None = None,
    embedder: EmbeddingService | None = None,
    index: IndexManager | None = None,
) -> dict[str, Any]:
    repository = repository or get_repository(uid)
    embedder = embedder or get_embedder()
    index = index or get_index()
    total_started = time.perf_counter()
    query_id = new_id("qry")
    created_at = utc_now()

    retrieval_started = time.perf_counter()
    vector = embedder.embed_query(query)
    candidates = index.search(vector, top_k)
    retrieval_ms = (time.perf_counter() - retrieval_started) * 1000

    # Different encoders live on different cosine scales. Use both an absolute
    # floor and a score relative to the best hit so a long tail of weak lexical
    # matches does not pollute the claim comparison set.
    if candidates:
        top_score = float(candidates[0][1])
        if embedder.backend == "hash":
            threshold = max(0.05, top_score * 0.35)
        else:
            threshold = max(0.10, top_score * 0.35)
        candidates = [
            (chunk_id, score) for chunk_id, score in candidates if score >= threshold
        ]
    else:
        candidates = []
    chunk_ids = [chunk_id for chunk_id, _ in candidates]
    chunks = repository.get_chunks_by_ids(chunk_ids)
    for rank, chunk in enumerate(chunks, start=1):
        chunk["retrieval_rank"] = rank
        chunk["retrieval_score"] = next(
            score for candidate_id, score in candidates if candidate_id == chunk["id"]
        )
        chunk["filename"] = chunk.get("filename", "source")

    analysis_started = time.perf_counter()
    claim_rows = repository.get_claims_for_chunks(chunk_ids)
    claims = [enrich_claim(row) for row in claim_rows]
    claims = _dedupe_claims(claims)
    if chunks and not claims:
        claims = _dedupe_claims(_fallback_claims(chunks))
    claims = _query_scope_claims(query, claims)

    # Keep claims ordered by retrieval rank, then confidence.
    rank_by_chunk = {chunk["id"]: chunk["retrieval_rank"] for chunk in chunks}
    claims.sort(
        key=lambda claim: (
            rank_by_chunk.get(claim.get("chunk_id"), 999),
            -float(claim.get("confidence", 0.5)),
        )
    )
    reasoning = analyze_claims(claims)
    citations = build_citations(chunks)
    analysis_ms = (time.perf_counter() - analysis_started) * 1000

    generation_started = time.perf_counter()
    answer, generation_backend = generate_answer(
        query=query,
        claims=claims,
        conflicts=reasoning.conflicts,
        citations=citations,
        consistency_score=reasoning.consistency_score,
        chunks_analyzed=len(chunks),
    )
    generation_ms = (time.perf_counter() - generation_started) * 1000
    total_ms = (time.perf_counter() - total_started) * 1000

    metrics = {
        "retrieval_ms": round(retrieval_ms, 1),
        "analysis_ms": round(analysis_ms, 1),
        "generation_ms": round(generation_ms, 1),
        "total_ms": round(total_ms, 1),
        "top_k": top_k,
        "retrieved_chunks": len(chunks),
        "claims_analyzed": reasoning.claims_analyzed,
        "pairs_analyzed": reasoning.pairs_analyzed,
        "relationship_counts": reasoning.counts,
        "embedding_backend": embedder.backend,
        "embedding_model": embedder.model_name,
        "index_type": index.index_type,
        "generation_backend": generation_backend,
    }

    for relationship in reasoning.relationships:
        relationship["query_id"] = query_id
        relationship["created_at"] = created_at

    repository.save_query(
        query_id=query_id,
        query=query,
        answer=answer,
        citations=citations,
        claims=claims,
        metrics=metrics,
        consistency_score=reasoning.consistency_score,
        chunks_analyzed=len(chunks),
        top_k=top_k,
        sources=[
            {
                "chunk_id": chunk["id"],
                "rank": chunk["retrieval_rank"],
                "score": round(float(chunk["retrieval_score"]), 6),
            }
            for chunk in chunks
        ],
        conflicts=reasoning.relationships,
    )

    result = {
        "query_id": query_id,
        "query": query,
        "answer": answer,
        "citations": citations,
        "claims": claims,
        "relationships": reasoning.relationships,
        "conflicts": reasoning.conflicts,
        "metrics": metrics,
        "consistency_score": reasoning.consistency_score,
        "chunks_analyzed": len(chunks),
        "created_at": created_at,
    }
    logger.info(
        "Query %s: %s chunks, %s claims, %s issues in %.0fms",
        query_id,
        len(chunks),
        len(claims),
        len(reasoning.conflicts),
        total_ms,
    )
    return result


def get_query_result(query_id: str, repository: Repository | None = None) -> dict[str, Any] | None:
    repository = repository or get_repository()
    row = repository.get_query(query_id)
    if not row:
        return None
    return _hydrate_result(row)
