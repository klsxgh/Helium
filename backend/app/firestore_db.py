"""Firestore-backed persistence for Helium.

Used when Firebase credentials are available (production / Vercel). Each user
gets an isolated subtree under ``users/{uid}``, so multi-tenant data never
leaks between accounts. The interface mirrors ``SqliteRepository`` so routers
and services work unchanged.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Iterable

from .services.firebase import get_firestore_client

logger = logging.getLogger("helium.firestore")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _to_dict(doc) -> dict[str, Any] | None:
    if not doc.exists:
        return None
    data = doc.to_dict() or {}
    data["id"] = doc.id
    return data


class FirestoreRepository:
    def __init__(self, uid: str):
        self.uid = uid
        self.db = get_firestore_client()
        self.user = self.db.collection("users").document(uid)

    def _col(self, name: str):
        return self.user.collection(name)

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    def init(self) -> None:
        # Firestore creates collections lazily; nothing to do.
        pass

    def transaction(self, write: bool = False):
        # Compatibility shim: callers use `with self.transaction(write=True)`.
        # Firestore transactions are created per-operation; return a no-op context.
        from contextlib import nullcontext

        return nullcontext()

    # ------------------------------------------------------------------
    # Documents
    # ------------------------------------------------------------------
    def create_document(self, *, document_id, filename, content_type, extension,
                        size_bytes, sha256, stored_path, version=1,
                        uid: str | None = None) -> dict[str, Any]:
        now = utc_now()
        doc = {
            "id": document_id,
            "filename": filename,
            "content_type": content_type,
            "extension": extension,
            "size_bytes": size_bytes,
            "sha256": sha256,
            "version": version,
            "status": "queued",
            "stage": "Queued",
            "progress": 0,
            "error": None,
            "chunk_count": 0,
            "page_count": 0,
            "doc_date": None,
            "stored_path": stored_path,
            "uploaded_at": now,
            "processed_at": None,
        }
        self._col("documents").document(document_id).set(doc)
        return self.get_document(document_id) or doc

    def next_version(self, filename: str, uid: str | None = None) -> int:
        docs = self._col("documents").where("filename", "==", filename).stream()
        versions = [int(d.to_dict().get("version", 1)) for d in docs]
        return (max(versions) if versions else 0) + 1

    def find_document_by_hash(self, sha256: str, uid: str | None = None):
        q = (
            self._col("documents")
            .where("sha256", "==", sha256)
            .where("status", "==", "ready")
            .order_by("uploaded_at", direction="DESCENDING")
            .limit(1)
            .stream()
        )
        for d in q:
            data = d.to_dict()
            data["id"] = d.id
            data["progress"] = int(data.get("progress") or 0)
            return data
        return None

    def get_document(self, document_id: str):
        snap = self._col("documents").document(document_id).get()
        data = _to_dict(snap)
        if data is not None:
            data["progress"] = int(data.get("progress") or 0)
        return data

    def list_documents(self, limit: int = 200, uid: str | None = None):
        q = self._col("documents").order_by("uploaded_at", direction="DESCENDING").limit(limit).stream()
        out = []
        for d in q:
            data = d.to_dict()
            data["id"] = d.id
            data["progress"] = int(data.get("progress") or 0)
            out.append(data)
        return out

    def update_document(self, document_id: str, **fields):
        allowed = {
            "status", "stage", "progress", "error", "chunk_count", "page_count",
            "doc_date", "processed_at", "content_type", "stored_path",
        }
        updates = {k: v for k, v in fields.items() if k in allowed}
        if not updates:
            return
        self._col("documents").document(document_id).update(updates)

    def delete_document(self, document_id: str):
        document = self.get_document(document_id)
        if not document:
            return None
        # Cascade: delete chunks and their claims.
        chunks = list(self._col("chunks").where("document_id", "==", document_id).stream())
        chunk_ids = [c.id for c in chunks]
        for c in chunks:
            c.reference.delete()
        if chunk_ids:
            claims = list(self._col("claims").stream())
            for cl in claims:
                if cl.to_dict().get("chunk_id") in chunk_ids:
                    cl.reference.delete()
        self._col("documents").document(document_id).delete()
        return document

    # ------------------------------------------------------------------
    # Chunks & claims
    # ------------------------------------------------------------------
    def insert_chunks(self, chunks, claims):
        now = utc_now()
        batch = self.db.batch()
        for chunk in chunks:
            ref = self._col("chunks").document(chunk["id"])
            batch.set(ref, {
                "id": chunk["id"],
                "document_id": chunk["document_id"],
                "chunk_index": chunk["chunk_index"],
                "page_number": chunk["page_number"],
                "section_heading": chunk.get("section_heading"),
                "text": chunk["text"],
                "token_count": chunk["token_count"],
                "embedding": chunk.get("embedding"),
                "created_at": now,
            })
        for claim in claims:
            ref = self._col("claims").document(claim["claim_id"])
            batch.set(ref, {
                "claim_id": claim["claim_id"],
                "chunk_id": claim["chunk_id"],
                "entity": claim.get("entity", ""),
                "entity_key": claim.get("entity_key", ""),
                "subject": claim.get("subject", ""),
                "action": claim.get("action", ""),
                "object": claim.get("object", ""),
                "modality": claim.get("modality", "informational"),
                "negation": 1 if claim.get("negation") else 0,
                "numeric_constraints": claim.get("numeric_constraints", []),
                "conditions": claim.get("conditions", []),
                "raw_text": claim.get("raw_text", ""),
                "confidence": float(claim.get("confidence", 0.6)),
                "created_at": now,
            })
        batch.commit()

    def clear_document_chunks(self, document_id: str):
        chunks = list(self._col("chunks").where("document_id", "==", document_id).stream())
        chunk_ids = {c.id for c in chunks}
        batch = self.db.batch()
        for c in chunks:
            batch.delete(c.reference)
        claims = list(self._col("claims").stream())
        for cl in claims:
            if cl.to_dict().get("chunk_id") in chunk_ids:
                batch.delete(cl.reference)
        batch.commit()

    def get_chunk(self, chunk_id: str):
        snap = self._col("chunks").document(chunk_id).get()
        data = _to_dict(snap)
        if not data:
            return None
        # denormalise document fields
        doc = self.get_document(data["document_id"]) or {}
        data["filename"] = doc.get("filename", "")
        data["doc_date"] = doc.get("doc_date")
        data["uploaded_at"] = doc.get("uploaded_at")
        data["version"] = doc.get("version", 1)
        data["document_status"] = doc.get("status")
        return data

    def get_chunks_by_ids(self, chunk_ids):
        if not chunk_ids:
            return []
        out = []
        for cid in chunk_ids:
            c = self.get_chunk(cid)
            if c:
                out.append(c)
        return out

    def list_chunks(self, document_id: str):
        q = self._col("chunks").where("document_id", "==", document_id).stream()
        out = sorted((d.to_dict() for d in q), key=lambda x: x.get("chunk_index", 0))
        for c in out:
            c["id"] = c.get("id") or ""
            doc = self.get_document(c["document_id"]) or {}
            c["filename"] = doc.get("filename", "")
            c["doc_date"] = doc.get("doc_date")
            c["uploaded_at"] = doc.get("uploaded_at")
            c["version"] = doc.get("version", 1)
            c["document_status"] = doc.get("status")
        return out

    def get_claims_for_chunks(self, chunk_ids):
        if not chunk_ids:
            return []
        wanted = set(chunk_ids)
        out = []
        for d in self._col("claims").stream():
            data = d.to_dict()
            if data.get("chunk_id") not in wanted:
                continue
            data["claim_id"] = data.get("claim_id") or d.id
            # attach chunk/document fields
            chunk = self.get_chunk(data["chunk_id"]) or {}
            data["document_id"] = chunk.get("document_id", "")
            data["page_number"] = chunk.get("page_number", 1)
            data["section_heading"] = chunk.get("section_heading")
            data["chunk_text"] = chunk.get("text", "")
            doc = self.get_document(chunk.get("document_id", "")) or {}
            data["filename"] = doc.get("filename", "")
            data["doc_date"] = doc.get("doc_date")
            data["uploaded_at"] = doc.get("uploaded_at")
            data["version"] = doc.get("version", 1)
            # normalise types
            data["negation"] = bool(data.get("negation"))
            if isinstance(data.get("numeric_constraints"), str):
                import json as _j
                data["numeric_constraints"] = _j.loads(data["numeric_constraints"] or "[]")
            if isinstance(data.get("conditions"), str):
                import json as _j
                data["conditions"] = _j.loads(data["conditions"] or "[]")
            out.append(data)
        return out

    def all_embedding_rows(self):
        out = []
        for d in self._col("chunks").stream():
            data = d.to_dict()
            if data.get("embedding") is not None:
                out.append({"id": d.id, "embedding": data["embedding"]})
        return out

    def count_chunks(self):
        return len(list(self._col("chunks").stream()))

    # ------------------------------------------------------------------
    # Queries & conflicts
    # ------------------------------------------------------------------
    def save_query(self, *, query_id, query, answer, citations, claims, metrics,
                   consistency_score, chunks_analyzed, top_k, sources, conflicts,
                   kind="query"):
        now = utc_now()
        issue_count = sum(1 for c in conflicts if c.get("relationship") in ("contradiction", "conditional_conflict", "ambiguity"))
        contradiction_count = sum(1 for c in conflicts if c.get("relationship") == "contradiction")
        query_doc = {
            "id": query_id,
            "query": query,
            "answer": answer,
            "citations": citations,
            "claims": claims,
            "metrics": metrics,
            "consistency_score": consistency_score,
            "chunks_analyzed": chunks_analyzed,
            "top_k": top_k,
            "kind": kind,
            "issue_count": issue_count,
            "contradiction_count": contradiction_count,
            "pair_count": len(conflicts),
            "created_at": now,
        }
        self._col("queries").document(query_id).set(query_doc)
        # write conflicts
        batch = self.db.batch()
        for conflict in conflicts:
            conflict.setdefault("query_id", query_id)
            conflict.setdefault("created_at", now)
            ref = self._col("conflicts").document(conflict["id"])
            batch.set(ref, {
                "id": conflict["id"],
                "query_id": query_id,
                "claim_a_id": conflict["claim_a"]["claim_id"],
                "claim_b_id": conflict["claim_b"]["claim_id"],
                "relationship": conflict["relationship"],
                "severity": conflict["severity"],
                "confidence": float(conflict["confidence"]),
                "explanation": conflict["explanation"],
                "mismatches": conflict.get("mismatches", []),
                "claim_a_json": conflict["claim_a"],
                "claim_b_json": conflict["claim_b"],
                "status": conflict.get("status", "open"),
                "resolution": conflict.get("resolution"),
                "active_claim_id": conflict.get("active_claim_id"),
                "resolved_by": conflict.get("resolved_by"),
                "resolution_note": conflict.get("resolution_note"),
                "resolved_at": conflict.get("resolved_at"),
                "created_at": now,
                "query_text": query,
            })
        batch.commit()

    def get_query(self, query_id: str):
        snap = self._col("queries").document(query_id).get()
        data = _to_dict(snap)
        if not data:
            return None
        data["conflicts"] = self.get_conflicts_for_query(query_id)
        return data

    def list_queries(self, limit: int = 30):
        q = self._col("queries").where("kind", "==", "query").order_by("created_at", direction="DESCENDING").limit(limit).stream()
        out = []
        for d in q:
            data = d.to_dict()
            data["id"] = d.id
            out.append(data)
        return out

    def get_conflicts_for_query(self, query_id: str):
        q = self._col("conflicts").where("query_id", "==", query_id).stream()
        out = []
        for d in q:
            data = d.to_dict()
            data["id"] = d.id
            # hydrate
            data["mismatches"] = data.get("mismatches", [])
            data["claim_a"] = data.get("claim_a_json", {})
            data["claim_b"] = data.get("claim_b_json", {})
            data.pop("claim_a_json", None)
            data.pop("claim_b_json", None)
            out.append(data)
        out.sort(key=lambda x: x.get("created_at", ""))
        return out

    def list_conflicts(self, status=None, limit=100):
        q = self._col("conflicts").order_by("created_at", direction="DESCENDING").limit(limit).stream()
        out = []
        for d in q:
            data = d.to_dict()
            if status and status != "all" and data.get("status") != status:
                continue
            data["id"] = d.id
            data["mismatches"] = data.get("mismatches", [])
            data["claim_a"] = data.get("claim_a_json", {})
            data["claim_b"] = data.get("claim_b_json", {})
            data.pop("claim_a_json", None)
            data.pop("claim_b_json", None)
            data["query_text"] = data.get("query_text")
            out.append(data)
        return out[:limit]

    def get_conflict(self, conflict_id: str):
        snap = self._col("conflicts").document(conflict_id).get()
        data = _to_dict(snap)
        if not data:
            return None
        data["mismatches"] = data.get("mismatches", [])
        data["claim_a"] = data.get("claim_a_json", {})
        data["claim_b"] = data.get("claim_b_json", {})
        data.pop("claim_a_json", None)
        data.pop("claim_b_json", None)
        data["query_text"] = data.get("query_text")
        return data

    def resolve_conflict(self, *, conflict_id, action, reviewer, note, active_claim_id):
        conflict = self.get_conflict(conflict_id)
        if not conflict:
            return None
        if action == "flag_review":
            status = "flagged"
            resolution = "flag_review"
        elif action == "mark_false_positive":
            status = "resolved"
            resolution = "false_positive"
        elif action in ("accept_newest", "keep_current"):
            status = "resolved"
            resolution = action
        elif action == "reopen":
            status = "open"
            resolution = None
        else:
            raise ValueError(f"Unsupported review action: {action}")

        now = utc_now()
        updates = {
            "status": status,
            "resolution": resolution,
            "active_claim_id": active_claim_id,
            "resolved_by": reviewer,
            "resolution_note": note,
            "resolved_at": now if action != "reopen" else None,
        }
        self._col("conflicts").document(conflict_id).update(updates)
        return self.get_conflict(conflict_id)

    # ------------------------------------------------------------------
    # Dashboard
    # ------------------------------------------------------------------
    def stats(self):
        docs = list(self._col("documents").stream())
        ready = sum(1 for d in docs if d.to_dict().get("status") == "ready")
        active = sum(1 for d in docs if d.to_dict().get("status") in ("processing", "queued"))
        chunks = len(list(self._col("chunks").stream()))
        queries = len(list(self._col("queries").where("kind", "==", "query").stream()))
        conflicts = list(self._col("conflicts").stream())
        open_c = sum(1 for c in conflicts if c.to_dict().get("status") == "open")
        flagged = sum(1 for c in conflicts if c.to_dict().get("status") == "flagged")
        resolved = sum(1 for c in conflicts if c.to_dict().get("status") == "resolved")
        contradictions = sum(1 for c in conflicts if c.to_dict().get("relationship") == "contradiction")
        return {
            "documents": len(docs),
            "documents_ready": ready,
            "documents_processing": active,
            "chunks": chunks,
            "queries": queries,
            "open_conflicts": open_c,
            "flagged_conflicts": flagged,
            "resolved_conflicts": resolved,
            "contradictions": contradictions,
        }

    def reset_all(self):
        for coll in ("documents", "chunks", "claims", "queries", "conflicts"):
            for d in list(self._col(coll).stream()):
                d.reference.delete()
