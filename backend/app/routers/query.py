"""RAG query, streaming answer, and query-history endpoints."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any, AsyncIterator

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from ..auth import CurrentUser
from ..config import get_settings
from ..db import get_repository
from ..schemas import HistoryItem, QueryRequest, QueryResult
from ..services.rag import get_query_result, run_query

logger = logging.getLogger("helium.query")
router = APIRouter(tags=["Query"])


def _sse(event: str, payload: Any) -> str:
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event}\ndata: {data}\n\n"


def _stream_pieces(text: str, size: int = 28) -> list[str]:
    pieces: list[str] = []
    current = ""
    for token in re.findall(r"\S+\s*", text):
        if current and len(current) + len(token) > size:
            pieces.append(current)
            current = ""
        current += token
    if current:
        pieces.append(current)
    return pieces


@router.post("/query", response_model=QueryResult, summary="Ask a grounded policy question")
async def query(request: QueryRequest, uid: str = CurrentUser) -> QueryResult:
    top_k = request.top_k or get_settings().retrieval_top_k
    result = await asyncio.to_thread(run_query, request.query, top_k, uid=uid)
    return QueryResult(**result)


@router.post(
    "/query/stream",
    summary="Stream a grounded answer and structured consistency report",
    response_class=StreamingResponse,
)
async def stream_query(request: QueryRequest, uid: str = CurrentUser) -> StreamingResponse:
    top_k = request.top_k or get_settings().retrieval_top_k

    async def event_stream() -> AsyncIterator[str]:
        yield _sse(
            "status",
            {"stage": "retrieving", "message": "Embedding query and searching the FAISS index…"},
        )
        try:
            result = await asyncio.to_thread(run_query, request.query, top_k, uid=uid)
        except Exception as exc:
            logger.exception("Streaming query failed")
            yield _sse("error", {"message": str(exc), "retryable": True})
            return

        yield _sse(
            "analysis",
            {
                "query_id": result["query_id"],
                "metrics": result["metrics"],
                "consistency_score": result["consistency_score"],
                "chunks_analyzed": result["chunks_analyzed"],
                "conflicts": result["conflicts"],
                "citations": result["citations"],
                "claims": result["claims"],
                "relationships": result["relationships"],
            },
        )
        for piece in _stream_pieces(result["answer"]):
            yield _sse("delta", {"text": piece})
            await asyncio.sleep(0.008)
        yield _sse("complete", result)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/history", response_model=list[HistoryItem], summary="Recent query history")
async def history(limit: int = Query(default=30, ge=1, le=200), uid: str = CurrentUser) -> list[HistoryItem]:
    rows = get_repository(uid).list_queries(limit=limit)
    return [
        HistoryItem(
            id=row["id"],
            query=row["query"],
            consistency_score=int(row.get("consistency_score") or 0),
            chunks_analyzed=int(row.get("chunks_analyzed") or 0),
            issue_count=int(row.get("issue_count") or 0),
            contradiction_count=int(row.get("contradiction_count") or 0),
            pair_count=int(row.get("pair_count") or 0),
            created_at=row["created_at"],
        )
        for row in rows
    ]


@router.get("/history/{query_id}", response_model=QueryResult, summary="Reopen a query report")
async def history_detail(query_id: str, uid: str = CurrentUser) -> QueryResult:
    result = get_query_result(query_id, repository=get_repository(uid))
    if not result:
        raise HTTPException(status_code=404, detail="Query not found.")
    return QueryResult(**result)
