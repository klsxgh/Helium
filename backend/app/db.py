"""SQLite persistence for Helium.

SQLite is deliberately used as the metadata source of truth. The FAISS index can
always be rebuilt from the stored float32 embeddings, which keeps recovery
deterministic.
"""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable, Iterator

from .utils import json_dumps, json_loads, utc_now
from .config import get_settings

SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    uid TEXT NOT NULL DEFAULT 'local',
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT '',
    extension TEXT NOT NULL DEFAULT '',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    sha256 TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'queued',
    stage TEXT NOT NULL DEFAULT 'Queued',
    progress INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    page_count INTEGER NOT NULL DEFAULT 0,
    doc_date TEXT,
    stored_path TEXT NOT NULL DEFAULT '',
    uploaded_at TEXT NOT NULL,
    processed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_documents_uid ON documents(uid);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_filename ON documents(filename);
CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(sha256);

CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    page_number INTEGER NOT NULL DEFAULT 1,
    section_heading TEXT,
    text TEXT NOT NULL,
    token_count INTEGER NOT NULL DEFAULT 0,
    embedding BLOB,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_created ON chunks(created_at);

CREATE TABLE IF NOT EXISTS claims (
    claim_id TEXT PRIMARY KEY,
    chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
    entity TEXT NOT NULL DEFAULT '',
    entity_key TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL DEFAULT '',
    object TEXT NOT NULL DEFAULT '',
    modality TEXT NOT NULL DEFAULT 'informational',
    negation INTEGER NOT NULL DEFAULT 0,
    numeric_constraints TEXT NOT NULL DEFAULT '[]',
    conditions TEXT NOT NULL DEFAULT '[]',
    raw_text TEXT NOT NULL DEFAULT '',
    confidence REAL NOT NULL DEFAULT 0.6,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_claims_chunk ON claims(chunk_id);

CREATE TABLE IF NOT EXISTS queries (
    id TEXT PRIMARY KEY,
    uid TEXT NOT NULL DEFAULT 'local',
    query TEXT NOT NULL,
    answer TEXT NOT NULL,
    citations TEXT NOT NULL DEFAULT '[]',
    claims TEXT NOT NULL DEFAULT '[]',
    metrics TEXT NOT NULL DEFAULT '{}',
    consistency_score INTEGER NOT NULL DEFAULT 100,
    chunks_analyzed INTEGER NOT NULL DEFAULT 0,
    top_k INTEGER NOT NULL DEFAULT 8,
    kind TEXT NOT NULL DEFAULT 'query',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_queries_uid ON queries(uid);
CREATE INDEX IF NOT EXISTS idx_queries_created ON queries(created_at DESC);

CREATE TABLE IF NOT EXISTS query_sources (
    query_id TEXT NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
    chunk_id TEXT NOT NULL,
    rank INTEGER NOT NULL,
    score REAL NOT NULL,
    PRIMARY KEY (query_id, chunk_id)
);

CREATE TABLE IF NOT EXISTS conflicts (
    id TEXT PRIMARY KEY,
    uid TEXT NOT NULL DEFAULT 'local',
    query_id TEXT NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
    claim_a_id TEXT NOT NULL,
    claim_b_id TEXT NOT NULL,
    relationship TEXT NOT NULL,
    severity TEXT NOT NULL,
    confidence REAL NOT NULL,
    explanation TEXT NOT NULL,
    mismatches TEXT NOT NULL DEFAULT '[]',
    claim_a_json TEXT NOT NULL,
    claim_b_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    resolution TEXT,
    active_claim_id TEXT,
    resolved_by TEXT,
    resolution_note TEXT,
    resolved_at TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conflicts_uid ON conflicts(uid);
CREATE INDEX IF NOT EXISTS idx_conflicts_query ON conflicts(query_id);
CREATE INDEX IF NOT EXISTS idx_conflicts_status ON conflicts(status);
CREATE INDEX IF NOT EXISTS idx_conflicts_relationship ON conflicts(relationship);
"""


def _row_to_document(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    item = dict(row)
    item["progress"] = int(item.get("progress") or 0)
    return item


class SqliteRepository:
    def __init__(self, path: Path | str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=45)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA busy_timeout=45000")
        return connection

    @contextmanager
    def transaction(self, write: bool = False) -> Iterator[sqlite3.Connection]:
        connection = self.connect()
        try:
            yield connection
            if write:
                connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def init(self) -> None:
        with self.transaction(write=True) as connection:
            connection.executescript(SCHEMA)
            self._migrate(connection)

    @staticmethod
    def _migrate(connection: sqlite3.Connection) -> None:
        """Apply small additive migrations for existing local installations."""

        def columns(table: str) -> set[str]:
            return {row["name"] for row in connection.execute(f"PRAGMA table_info({table})")}

        claim_columns = columns("claims")
        if "subject" not in claim_columns:
            connection.execute("ALTER TABLE claims ADD COLUMN subject TEXT NOT NULL DEFAULT ''")
        query_columns = columns("queries")
        if "claims" not in query_columns:
            connection.execute("ALTER TABLE queries ADD COLUMN claims TEXT NOT NULL DEFAULT '[]'")
        if "kind" not in query_columns:
            connection.execute("ALTER TABLE queries ADD COLUMN kind TEXT NOT NULL DEFAULT 'query'")

    # ------------------------------------------------------------------
    # Documents
    # ------------------------------------------------------------------
    def create_document(
        self,
        *,
        document_id: str,
        filename: str,
        content_type: str,
        extension: str,
        size_bytes: int,
        sha256: str,
        stored_path: str,
        version: int = 1,
    ) -> dict[str, Any]:
        now = utc_now()
        with self.transaction(write=True) as connection:
            connection.execute(
                """
                INSERT INTO documents (
                    id, filename, content_type, extension, size_bytes, sha256,
                    version, status, stage, progress, stored_path, uploaded_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 'Queued', 0, ?, ?)
                """,
                (
                    document_id,
                    filename,
                    content_type,
                    extension,
                    size_bytes,
                    sha256,
                    version,
                    stored_path,
                    now,
                ),
            )
        return self.get_document(document_id) or {}

    def next_version(self, filename: str) -> int:
        with self.transaction() as connection:
            row = connection.execute(
                "SELECT COALESCE(MAX(version), 0) + 1 AS next FROM documents WHERE lower(filename) = lower(?)",
                (filename,),
            ).fetchone()
        return int(row["next"]) if row else 1

    def find_document_by_hash(self, sha256: str) -> dict[str, Any] | None:
        with self.transaction() as connection:
            row = connection.execute(
                "SELECT * FROM documents WHERE sha256 = ? AND status = 'ready' ORDER BY uploaded_at DESC LIMIT 1",
                (sha256,),
            ).fetchone()
        return _row_to_document(row)

    def get_document(self, document_id: str) -> dict[str, Any] | None:
        with self.transaction() as connection:
            row = connection.execute(
                "SELECT * FROM documents WHERE id = ?", (document_id,)
            ).fetchone()
        return _row_to_document(row)

    def list_documents(self, limit: int = 200) -> list[dict[str, Any]]:
        with self.transaction() as connection:
            rows = connection.execute(
                "SELECT * FROM documents ORDER BY uploaded_at DESC LIMIT ?", (limit,)
            ).fetchall()
        return [item for row in rows if (item := _row_to_document(row)) is not None]

    def update_document(self, document_id: str, **fields: Any) -> None:
        if not fields:
            return
        allowed = {
            "status",
            "stage",
            "progress",
            "error",
            "chunk_count",
            "page_count",
            "doc_date",
            "processed_at",
            "content_type",
            "stored_path",
        }
        updates = {key: value for key, value in fields.items() if key in allowed}
        if not updates:
            return
        assignments = ", ".join(f"{key} = ?" for key in updates)
        with self.transaction(write=True) as connection:
            connection.execute(
                f"UPDATE documents SET {assignments} WHERE id = ?",
                (*updates.values(), document_id),
            )

    def delete_document(self, document_id: str) -> dict[str, Any] | None:
        document = self.get_document(document_id)
        if not document:
            return None
        with self.transaction(write=True) as connection:
            connection.execute("DELETE FROM documents WHERE id = ?", (document_id,))
        return document

    def reset_all(self) -> None:
        """Delete every document, report, and conflict so the workspace starts fresh."""
        with self.transaction(write=True) as connection:
            connection.execute("DELETE FROM queries")
            connection.execute("DELETE FROM documents")
        with self.transaction(write=True) as connection:
            connection.execute("VACUUM")

    # ------------------------------------------------------------------
    # Chunks & claims
    # ------------------------------------------------------------------
    def insert_chunks(
        self,
        chunks: Iterable[dict[str, Any]],
        claims: Iterable[dict[str, Any]],
    ) -> None:
        now = utc_now()
        with self.transaction(write=True) as connection:
            connection.executemany(
                """
                INSERT INTO chunks (
                    id, document_id, chunk_index, page_number, section_heading,
                    text, token_count, embedding, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        chunk["id"],
                        chunk["document_id"],
                        chunk["chunk_index"],
                        chunk["page_number"],
                        chunk.get("section_heading"),
                        chunk["text"],
                        chunk["token_count"],
                        chunk.get("embedding"),
                        now,
                    )
                    for chunk in chunks
                ],
            )
            connection.executemany(
                """
                INSERT INTO claims (
                    claim_id, chunk_id, entity, entity_key, subject, action, object,
                    modality, negation, numeric_constraints, conditions, raw_text,
                    confidence, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        claim["claim_id"],
                        claim["chunk_id"],
                        claim.get("entity", ""),
                        claim.get("entity_key", ""),
                        claim.get("subject", ""),
                        claim.get("action", ""),
                        claim.get("object", ""),
                        claim.get("modality", "informational"),
                        1 if claim.get("negation") else 0,
                        json_dumps(claim.get("numeric_constraints", [])),
                        json_dumps(claim.get("conditions", [])),
                        claim.get("raw_text", ""),
                        float(claim.get("confidence", 0.6)),
                        now,
                    )
                    for claim in claims
                ],
            )

    def clear_document_chunks(self, document_id: str) -> None:
        with self.transaction(write=True) as connection:
            connection.execute("DELETE FROM chunks WHERE document_id = ?", (document_id,))

    def get_chunk(self, chunk_id: str) -> dict[str, Any] | None:
        with self.transaction() as connection:
            row = connection.execute(
                """
                SELECT c.id, c.document_id, c.chunk_index, c.page_number, c.section_heading,
                       c.text, c.token_count, c.created_at,
                       d.filename, d.doc_date, d.uploaded_at, d.version,
                       d.status AS document_status
                FROM chunks c JOIN documents d ON d.id = c.document_id
                WHERE c.id = ?
                """,
                (chunk_id,),
            ).fetchone()
        return dict(row) if row else None

    def get_chunks_by_ids(self, chunk_ids: list[str]) -> list[dict[str, Any]]:
        if not chunk_ids:
            return []
        placeholders = ",".join("?" for _ in chunk_ids)
        with self.transaction() as connection:
            rows = connection.execute(
                f"""
                SELECT c.id, c.document_id, c.chunk_index, c.page_number, c.section_heading,
                       c.text, c.token_count, c.created_at,
                       d.filename, d.doc_date, d.uploaded_at, d.version,
                       d.status AS document_status
                FROM chunks c JOIN documents d ON d.id = c.document_id
                WHERE c.id IN ({placeholders})
                """,
                chunk_ids,
            ).fetchall()
        by_id = {row["id"]: dict(row) for row in rows}
        return [by_id[chunk_id] for chunk_id in chunk_ids if chunk_id in by_id]

    def list_chunks(self, document_id: str) -> list[dict[str, Any]]:
        with self.transaction() as connection:
            rows = connection.execute(
                """
                SELECT c.*, d.filename, d.doc_date, d.uploaded_at, d.version,
                       d.status AS document_status
                FROM chunks c JOIN documents d ON d.id = c.document_id
                WHERE c.document_id = ?
                ORDER BY c.chunk_index
                """,
                (document_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_claims_for_chunks(self, chunk_ids: list[str]) -> list[dict[str, Any]]:
        if not chunk_ids:
            return []
        placeholders = ",".join("?" for _ in chunk_ids)
        with self.transaction() as connection:
            rows = connection.execute(
                f"""
                SELECT cl.*, c.document_id, c.page_number, c.section_heading,
                       c.text AS chunk_text, d.filename, d.doc_date, d.uploaded_at,
                       d.version
                FROM claims cl
                JOIN chunks c ON c.id = cl.chunk_id
                JOIN documents d ON d.id = c.document_id
                WHERE cl.chunk_id IN ({placeholders})
                ORDER BY c.chunk_index, cl.created_at
                """,
                chunk_ids,
            ).fetchall()
        claims = []
        for row in rows:
            claim = dict(row)
            claim["negation"] = bool(claim["negation"])
            claim["numeric_constraints"] = json_loads(claim.get("numeric_constraints"), [])
            claim["conditions"] = json_loads(claim.get("conditions"), [])
            claims.append(claim)
        return claims

    def all_embedding_rows(self) -> list[dict[str, Any]]:
        with self.transaction() as connection:
            rows = connection.execute(
                "SELECT id, embedding FROM chunks WHERE embedding IS NOT NULL ORDER BY created_at, id"
            ).fetchall()
        return [dict(row) for row in rows]

    def count_chunks(self) -> int:
        with self.transaction() as connection:
            row = connection.execute("SELECT COUNT(*) AS count FROM chunks").fetchone()
        return int(row["count"]) if row else 0

    # ------------------------------------------------------------------
    # Queries & conflict records
    # ------------------------------------------------------------------
    def save_query(
        self,
        *,
        query_id: str,
        query: str,
        answer: str,
        citations: list[dict[str, Any]],
        claims: list[dict[str, Any]],
        metrics: dict[str, Any],
        consistency_score: int,
        chunks_analyzed: int,
        top_k: int,
        sources: list[dict[str, Any]],
        conflicts: list[dict[str, Any]],
        kind: str = "query",
    ) -> None:
        now = utc_now()
        with self.transaction(write=True) as connection:
            connection.execute(
                """
                INSERT INTO queries (
                    id, query, answer, citations, claims, metrics, consistency_score,
                    chunks_analyzed, top_k, kind, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    query_id,
                    query,
                    answer,
                    json_dumps(citations),
                    json_dumps(claims),
                    json_dumps(metrics),
                    consistency_score,
                    chunks_analyzed,
                    top_k,
                    kind,
                    now,
                ),
            )
            connection.executemany(
                """
                INSERT INTO query_sources (query_id, chunk_id, rank, score)
                VALUES (?, ?, ?, ?)
                """,
                [
                    (query_id, source["chunk_id"], source["rank"], source["score"])
                    for source in sources
                ],
            )
            connection.executemany(
                """
                INSERT INTO conflicts (
                    id, query_id, claim_a_id, claim_b_id, relationship, severity,
                    confidence, explanation, mismatches, claim_a_json, claim_b_json,
                    status, resolution, active_claim_id, resolved_by,
                    resolution_note, resolved_at, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        conflict["id"],
                        query_id,
                        conflict["claim_a"]["claim_id"],
                        conflict["claim_b"]["claim_id"],
                        conflict["relationship"],
                        conflict["severity"],
                        float(conflict["confidence"]),
                        conflict["explanation"],
                        json_dumps(conflict.get("mismatches", [])),
                        json_dumps(conflict["claim_a"]),
                        json_dumps(conflict["claim_b"]),
                        conflict.get("status", "open"),
                        conflict.get("resolution"),
                        conflict.get("active_claim_id"),
                        conflict.get("resolved_by"),
                        conflict.get("resolution_note"),
                        conflict.get("resolved_at"),
                        now,
                    )
                    for conflict in conflicts
                ],
            )

    def get_query(self, query_id: str) -> dict[str, Any] | None:
        with self.transaction() as connection:
            row = connection.execute(
                "SELECT * FROM queries WHERE id = ?", (query_id,)
            ).fetchone()
        if not row:
            return None
        query = dict(row)
        query["citations"] = json_loads(query.get("citations"), [])
        query["claims"] = json_loads(query.get("claims"), [])
        query["metrics"] = json_loads(query.get("metrics"), {})
        query["conflicts"] = self.get_conflicts_for_query(query_id)
        return query

    def list_queries(self, limit: int = 30) -> list[dict[str, Any]]:
        with self.transaction() as connection:
            rows = connection.execute(
                """
                SELECT q.id, q.query, q.consistency_score, q.chunks_analyzed, q.created_at,
                       SUM(CASE WHEN cf.relationship IN ('contradiction', 'conditional_conflict', 'ambiguity') THEN 1 ELSE 0 END) AS issue_count,
                       SUM(CASE WHEN cf.relationship = 'contradiction' THEN 1 ELSE 0 END) AS contradiction_count,
                       COUNT(cf.id) AS pair_count
                FROM queries q
                LEFT JOIN conflicts cf ON cf.query_id = q.id
                WHERE q.kind = 'query'
                GROUP BY q.id
                ORDER BY q.created_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_conflicts_for_query(self, query_id: str) -> list[dict[str, Any]]:
        with self.transaction() as connection:
            rows = connection.execute(
                "SELECT * FROM conflicts WHERE query_id = ? ORDER BY created_at ASC",
                (query_id,),
            ).fetchall()
        return [self._hydrate_conflict(row) for row in rows]

    def list_conflicts(
        self, status: str | None = None, limit: int = 100
    ) -> list[dict[str, Any]]:
        sql = """
            SELECT cf.*, q.query AS query_text
            FROM conflicts cf JOIN queries q ON q.id = cf.query_id
        """
        params: list[Any] = []
        if status and status != "all":
            sql += " WHERE cf.status = ?"
            params.append(status)
        sql += " ORDER BY cf.created_at DESC LIMIT ?"
        params.append(limit)
        with self.transaction() as connection:
            rows = connection.execute(sql, params).fetchall()
        return [self._hydrate_conflict(row, include_query=True) for row in rows]

    def get_conflict(self, conflict_id: str) -> dict[str, Any] | None:
        with self.transaction() as connection:
            row = connection.execute(
                """
                SELECT cf.*, q.query AS query_text
                FROM conflicts cf JOIN queries q ON q.id = cf.query_id
                WHERE cf.id = ?
                """,
                (conflict_id,),
            ).fetchone()
        return self._hydrate_conflict(row, include_query=True) if row else None

    def _hydrate_conflict(
        self, row: sqlite3.Row, include_query: bool = False
    ) -> dict[str, Any]:
        item = dict(row)
        item["mismatches"] = json_loads(item.get("mismatches"), [])
        item["claim_a"] = json_loads(item.get("claim_a_json"), {})
        item["claim_b"] = json_loads(item.get("claim_b_json"), {})
        item.pop("claim_a_json", None)
        item.pop("claim_b_json", None)
        if not include_query:
            item.pop("query_text", None)
        return item

    def resolve_conflict(
        self,
        *,
        conflict_id: str,
        action: str,
        reviewer: str,
        note: str | None,
        active_claim_id: str | None,
    ) -> dict[str, Any] | None:
        conflict = self.get_conflict(conflict_id)
        if not conflict:
            return None
        if action == "flag_review":
            status = "flagged"
            resolution = "flag_review"
        elif action == "mark_false_positive":
            status = "resolved"
            resolution = "false_positive"
        elif action in {"accept_newest", "keep_current"}:
            status = "resolved"
            resolution = action
        elif action == "reopen":
            status = "open"
            resolution = None
        else:
            raise ValueError(f"Unsupported review action: {action}")

        now = utc_now()
        with self.transaction(write=True) as connection:
            connection.execute(
                """
                UPDATE conflicts
                SET status = ?, resolution = ?, active_claim_id = ?, resolved_by = ?,
                    resolution_note = ?, resolved_at = ?
                WHERE id = ?
                """,
                (
                    status,
                    resolution,
                    active_claim_id,
                    reviewer,
                    note,
                    now if action != "reopen" else None,
                    conflict_id,
                ),
            )
        return self.get_conflict(conflict_id)

    # ------------------------------------------------------------------
    # Dashboard
    # ------------------------------------------------------------------
    def stats(self) -> dict[str, Any]:
        with self.transaction() as connection:
            documents = connection.execute(
                """
                SELECT COUNT(*) AS total,
                       SUM(CASE WHEN status = 'processing' OR status = 'queued' THEN 1 ELSE 0 END) AS active
                FROM documents
                """
            ).fetchone()
            chunks = connection.execute("SELECT COUNT(*) AS total FROM chunks").fetchone()
            queries = connection.execute(
                "SELECT COUNT(*) AS total FROM queries WHERE kind = 'query'"
            ).fetchone()
            conflicts = connection.execute(
                """
                SELECT
                    SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_count,
                    SUM(CASE WHEN status = 'flagged' THEN 1 ELSE 0 END) AS flagged_count,
                    SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved_count,
                    SUM(CASE WHEN relationship = 'contradiction' THEN 1 ELSE 0 END) AS contradictions
                FROM conflicts
                """
            ).fetchone()
            ready = connection.execute(
                "SELECT COUNT(*) AS total FROM documents WHERE status = 'ready'"
            ).fetchone()
        return {
            "documents": int(documents["total"] or 0),
            "documents_ready": int(ready["total"] or 0),
            "documents_processing": int(documents["active"] or 0),
            "chunks": int(chunks["total"] or 0),
            "queries": int(queries["total"] or 0),
            "open_conflicts": int(conflicts["open_count"] or 0),
            "flagged_conflicts": int(conflicts["flagged_count"] or 0),
            "resolved_conflicts": int(conflicts["resolved_count"] or 0),
            "contradictions": int(conflicts["contradictions"] or 0),
        }


_repository: Repository | None = None


Repository = SqliteRepository

def get_repository(uid: str | None = None) -> Any:
    global _repository
    # Firestore path: when Firebase is configured, use per-user Firestore storage.
    try:
        from .services.firebase import firebase_enabled

        if firebase_enabled() and uid is not None:
            from .firestore_db import FirestoreRepository

            return FirestoreRepository(uid)
    except Exception:
        pass
    # SQLite fallback (local dev / tests / unauthenticated).
    if _repository is None:
        _repository = SqliteRepository(get_settings().db_path)
        _repository.init()
    return _repository
