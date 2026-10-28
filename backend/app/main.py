"""Helium FastAPI application entry point."""

from __future__ import annotations

import asyncio
import importlib.util
import logging
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import get_settings
from .db import get_repository
from .routers import admin, ingest, query, scan
from .schemas import HealthOut
from .services.embedder import get_embedder, get_index
from .services.ingestion import process_documents, seed_demo_corpus

settings = get_settings()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)
logger = logging.getLogger("helium")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    logger.info("Starting Helium %s in %s mode", settings.app_version, settings.environment)
    repository = get_repository()
    repository.init()
    try:
        await asyncio.to_thread(get_index().startup)
        logger.info("Vector index ready: %s", get_index().status())
    except Exception:
        logger.exception("Vector index startup failed; ingestion can still repair it")

    if settings.demo_seed:
        try:
            docs, ids = await asyncio.to_thread(seed_demo_corpus, repository)
            if ids:
                logger.info("Seeding %s demonstration documents", len(ids))
                await asyncio.to_thread(process_documents, ids)
        except Exception:
            logger.exception("Demo corpus seeding failed")

    logger.info("Helium API ready at %s", settings.api_prefix)
    yield
    logger.info("Helium API shutting down")


app = FastAPI(
    title="Helium API",
    description=(
        "Contradiction-aware retrieval-augmented generation. Helium retrieves evidence, "
        "structures it into claims, detects inconsistencies, and explains every relationship "
        "with source-level citations."
    ),
    version=settings.app_version,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID", "X-Process-Time"],
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or f"req_{uuid.uuid4().hex[:16]}"
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("Unhandled request failure [%s] %s", request_id, request.url.path)
        raise
    elapsed_ms = (time.perf_counter() - started) * 1000
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Process-Time"] = f"{elapsed_ms:.1f}ms"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    if elapsed_ms > 2000:
        logger.warning("Slow request [%s] %s %.0fms", request_id, request.url.path, elapsed_ms)
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled exception on %s", request.url.path)
    return JSONResponse(
        status_code=500,
        content={
            "detail": "An internal error occurred while processing the request.",
            "path": request.url.path,
        },
    )


app.include_router(ingest.router, prefix=settings.api_prefix)
app.include_router(query.router, prefix=settings.api_prefix)
app.include_router(admin.router, prefix=settings.api_prefix)
app.include_router(scan.router, prefix=settings.api_prefix)


def _capability(module: str) -> bool:
    try:
        return importlib.util.find_spec(module) is not None
    except (ImportError, ValueError):
        return False


@app.get("/", include_in_schema=False)
async def root() -> dict[str, Any]:
    return {
        "name": "Helium",
        "tagline": "Contradiction-aware RAG for policy intelligence",
        "version": settings.app_version,
        "api": settings.api_prefix,
        "docs": "/docs",
    }


@app.get(f"{settings.api_prefix}/health", response_model=HealthOut, tags=["System"])
async def health() -> HealthOut:
    repository = get_repository()
    try:
        index_status = get_index().status()
        embedding = get_embedder().status()
    except Exception as exc:
        index_status = {"status": "error", "error": str(exc)}
        embedding = {"backend": "unknown", "error": str(exc)}
    stats = repository.stats()
    capabilities = {
        "faiss": _capability("faiss"),
        "sentence_transformers": _capability("sentence_transformers"),
        "spacy": _capability("spacy"),
        "transformers": _capability("transformers"),
        "pdfplumber": _capability("pdfplumber"),
        "pypdf": _capability("pypdf"),
        "python_docx": _capability("docx"),
        "local_llm_enabled": settings.llm_enabled,
        "embedding": embedding,
    }
    degraded = index_status.get("status") == "error"
    return HealthOut(
        status="degraded" if degraded else "ok",
        app=settings.app_name,
        version=settings.app_version,
        index=index_status,
        stats=stats,
        capabilities=capabilities,
    )


@app.get(f"{settings.api_prefix}/config", tags=["System"])
async def public_config() -> dict[str, Any]:
    return {
        "app_name": settings.app_name,
        "version": settings.app_version,
        "chunk_size": settings.default_chunk_size,
        "chunk_overlap": settings.default_chunk_overlap,
        "top_k": settings.retrieval_top_k,
        "max_files": settings.max_files_per_upload,
        "max_upload_mb": settings.max_upload_mb,
        "supported_extensions": [".pdf", ".docx", ".txt"],
        "llm_enabled": settings.llm_enabled,
    }
