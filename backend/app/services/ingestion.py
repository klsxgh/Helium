"""Document ingestion orchestration."""

from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import Any

import numpy as np

from ..config import get_settings
from ..db import Repository, get_repository
from ..utils import new_id, utc_now
from .embedder import EmbeddingService, IndexManager, get_embedder, get_index
from .extractor import extract_claims
from .parser import DocumentParseError, parse_and_chunk

logger = logging.getLogger("helium.ingestion")


def process_document(
    document_id: str,
    *,
    repository: Repository | None = None,
    embedder: EmbeddingService | None = None,
    index: IndexManager | None = None,
) -> None:
    settings = get_settings()
    repository = repository or get_repository()
    embedder = embedder or get_embedder()
    index = index or get_index()
    document = repository.get_document(document_id)
    if not document:
        logger.warning("Document %s disappeared before ingestion", document_id)
        return
    path = Path(document["stored_path"])
    if not path.exists():
        repository.update_document(
            document_id,
            status="failed",
            stage="Failed",
            error="Uploaded file is missing from storage.",
            progress=0,
        )
        return

    try:
        repository.update_document(
            document_id, status="processing", stage="Parsing document", progress=8, error=None
        )
        parsed, drafts = parse_and_chunk(
            path,
            document["filename"],
            chunk_size=settings.default_chunk_size,
            overlap=settings.default_chunk_overlap,
        )
        if not drafts:
            raise DocumentParseError("No text chunks could be created from this document.")
        repository.update_document(
            document_id,
            page_count=parsed.page_count,
            doc_date=parsed.doc_date,
            stage="Extracting claims",
            progress=28,
        )

        chunks: list[dict[str, Any]] = []
        claims: list[dict[str, Any]] = []
        for draft in drafts:
            chunk_id = new_id("chk")
            chunk_claims = extract_claims(
                chunk_id,
                draft.text,
                section_heading=draft.section_heading,
                max_claims=settings.max_claims_per_chunk,
            )
            chunks.append(
                {
                    "id": chunk_id,
                    "document_id": document_id,
                    "chunk_index": draft.chunk_index,
                    "page_number": draft.page_number,
                    "section_heading": draft.section_heading,
                    "text": draft.text,
                    "token_count": draft.token_count,
                }
            )
            claims.extend(chunk_claims)

        repository.update_document(
            document_id, stage="Generating embeddings", progress=52
        )
        texts = [chunk["text"] for chunk in chunks]
        vectors = embedder.embed_texts(texts)
        if vectors.shape[0] != len(chunks):
            raise RuntimeError("Embedding count did not match the chunk count.")
        for chunk, vector in zip(chunks, vectors):
            chunk["embedding"] = np.asarray(vector, dtype=np.float32).tobytes()

        repository.update_document(
            document_id, stage="Indexing in FAISS", progress=82
        )
        repository.insert_chunks(chunks, claims)
        index.add([chunk["id"] for chunk in chunks], vectors)
        repository.update_document(
            document_id,
            status="ready",
            stage="Ready",
            progress=100,
            error=None,
            chunk_count=len(chunks),
            page_count=parsed.page_count,
            doc_date=parsed.doc_date,
            processed_at=utc_now(),
        )
        logger.info(
            "Ingested %s (%s chunks, %s claims)", document["filename"], len(chunks), len(claims)
        )
    except Exception as exc:
        logger.exception("Ingestion failed for %s", document["filename"])
        repository.clear_document_chunks(document_id)
        try:
            index.rebuild()
        except Exception:
            logger.exception("Could not rebuild index after ingestion failure")
        repository.update_document(
            document_id,
            status="failed",
            stage="Failed",
            progress=0,
            error=str(exc)[:2000],
            chunk_count=0,
        )
        logger.exception("Ingestion failed for %s", document["filename"])


def process_documents(document_ids: list[str]) -> None:
    for document_id in document_ids:
        process_document(document_id)


def delete_document(
    document_id: str,
    *,
    repository: Repository | None = None,
    index: IndexManager | None = None,
) -> bool:
    repository = repository or get_repository()
    index = index or get_index()
    document = repository.get_document(document_id)
    if not document:
        return False
    stored_path = Path(document.get("stored_path") or "")
    removed = repository.delete_document(document_id)
    if not removed:
        return False
    try:
        if stored_path.exists() and stored_path.is_file():
            stored_path.unlink()
    except OSError:
        logger.warning("Could not remove uploaded file %s", stored_path)
    index.rebuild()
    return True


def reindex_document(
    document_id: str,
    *,
    repository: Repository | None = None,
    index: IndexManager | None = None,
) -> bool:
    repository = repository or get_repository()
    index = index or get_index()
    document = repository.get_document(document_id)
    if not document:
        return False
    repository.clear_document_chunks(document_id)
    index.rebuild()
    repository.update_document(
        document_id,
        status="queued",
        stage="Queued for re-index",
        progress=0,
        error=None,
        chunk_count=0,
    )
    process_document(document_id, repository=repository, index=index)
    return True


def register_file(
    *,
    filename: str,
    content: bytes,
    content_type: str = "text/plain",
    extension: str,
    sha256: str,
    repository: Repository | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    repository = repository or get_repository()
    document_id = new_id("doc")
    stored_path = settings.upload_dir / f"{document_id}{extension}"
    stored_path.write_bytes(content)
    version = repository.next_version(filename)
    try:
        return repository.create_document(
            document_id=document_id,
            filename=filename,
            content_type=content_type,
            extension=extension,
            size_bytes=len(content),
            sha256=sha256,
            stored_path=str(stored_path),
            version=version,
        )
    except Exception:
        try:
            stored_path.unlink()
        except OSError:
            pass
        raise


DEMO_DOCUMENTS: list[tuple[str, str]] = [
    (
        "HR_Policy_2024.txt",
        """ACME CORPORATION — CONFIDENTIAL
Employee Handbook
Effective Date: January 1, 2024
Version 4.2

Remote Work Policy
Employees must work from the office at least 3 days per week. Remote employees must log 40 core hours each week in the time-tracking system. Managers should review remote attendance monthly.
All remote work arrangements must be approved by the employee's direct manager before the arrangement begins.

Data Retention
Employee records must be retained for 7 years after termination. Access logs must be retained for 12 months.

Expense Reimbursement
Employees must submit receipts within 7 days of purchase. Travel expenses above $500 require prior written approval from a vice president. Meals are reimbursed up to $75 per day.

Leave and Time Off
Employees must request planned leave at least 10 business days in advance. Unused vacation days may be carried over to the next calendar year.

Page 1 of 1
""",
    ),
    (
        "Remote_Work_Addendum_2026.txt",
        """ACME CORPORATION — INTERNAL USE ONLY
Remote Work Addendum
Effective Date: February 1, 2026
Revision 1.0

Remote Work Policy
Core hour logging is optional for senior engineers. Senior engineers may work remotely full-time and are not required to work from the office 3 days per week. All other employees must continue to work from the office at least 3 days per week.
Senior engineers should provide their manager with a quarterly availability summary, but this summary is not required for approval.

Data Retention
Employee records are retained for 10 years after termination. Access logs are retained for 18 months.

Expense Reimbursement
Receipt submission is not required for expenses under $50. All travel expenses must receive prior written approval, regardless of amount. Meal reimbursements remain capped at $75 per day.
""",
    ),
    (
        "Expense_Reimbursement_2025.txt",
        """ACME CORPORATION
Expense Reimbursement Policy
Effective Date: March 15, 2025

Expense Reimbursement
Receipts must be submitted within 14 days of purchase for all business expenses. Travel expenses above $1,000 require prior written approval from a vice president. Receipts are required for every expense, including meals.
Employees may use a corporate card for approved travel. Personal card expenses must be submitted within 30 days of the transaction date.

Data Retention
Expense records must be retained for 7 years.
""",
    ),
]


def seed_demo_corpus(repository: Repository | None = None) -> tuple[list[dict[str, Any]], list[str]]:
    """Create three intentionally overlapping policy files for demonstration.

    Returns the created documents plus their IDs so the API can queue ingestion.
    Existing files with the same names are left untouched.
    """

    import hashlib

    repository = repository or get_repository()
    existing = {doc["filename"] for doc in repository.list_documents(limit=500)}
    documents: list[dict[str, Any]] = []
    ids: list[str] = []
    settings = get_settings()
    sample_dir = settings.upload_dir / "samples"
    sample_dir.mkdir(parents=True, exist_ok=True)
    for filename, content in DEMO_DOCUMENTS:
        if filename in existing:
            continue
        data = content.encode("utf-8")
        digest = hashlib.sha256(data).hexdigest()
        document = register_file(
            filename=filename,
            content=data,
            content_type="text/plain",
            extension=".txt",
            sha256=digest,
            repository=repository,
        )
        documents.append(document)
        ids.append(document["id"])
        # Keep a downloadable copy in the sample directory for operators.
        try:
            shutil.copyfile(document["stored_path"], sample_dir / filename)
        except OSError:
            pass
    return documents, ids
