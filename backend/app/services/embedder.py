"""Dense embedding service and persistent FAISS retrieval index."""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import threading
from pathlib import Path
from typing import Any, Sequence

import numpy as np

from ..config import get_settings
from ..db import Repository, get_repository

logger = logging.getLogger("helium.embedder")

STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "been",
    "but",
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
    "he",
    "her",
    "his",
    "if",
    "in",
    "into",
    "is",
    "it",
    "its",
    "may",
    "must",
    "not",
    "of",
    "on",
    "or",
    "our",
    "shall",
    "should",
    "that",
    "the",
    "their",
    "them",
    "there",
    "these",
    "they",
    "this",
    "to",
    "was",
    "we",
    "were",
    "will",
    "with",
    "would",
    "you",
    "your",
}


def _normalise(matrix: np.ndarray) -> np.ndarray:
    if matrix.ndim == 1:
        norm = float(np.linalg.norm(matrix))
        return matrix / norm if norm else matrix
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return matrix / norms


class HashEmbedder:
    """Deterministic offline fallback embedding.

    This is not a replacement for a trained sentence encoder, but it keeps the
    complete ingestion and retrieval workflow usable in air-gapped environments
    where the model cannot be downloaded. Word, bigram, and character n-grams
    are hashed into a signed feature space and L2-normalised.
    """

    def __init__(self, dimension: int = 768):
        self.dimension = dimension
        self.backend = "hash"
        self.model_name = "helium-hash-ngram-v1"

    def embed(self, texts: Sequence[str]) -> np.ndarray:
        vectors = np.zeros((len(texts), self.dimension), dtype=np.float32)
        for row, text in enumerate(texts):
            tokens = [token for token in text.lower().replace("\n", " ").split() if token]
            features: list[tuple[str, float]] = []
            for token in tokens:
                cleaned = "".join(ch for ch in token if ch.isalnum() or ch in "-_/.")
                if not cleaned:
                    continue
                if cleaned not in STOPWORDS and len(cleaned) > 1:
                    features.append((f"w:{cleaned}", 1.0))
                for ngram in self._char_ngrams(cleaned, 4):
                    features.append((f"c:{ngram}", 0.35))
            for left, right in zip(tokens, tokens[1:]):
                if left not in STOPWORDS or right not in STOPWORDS:
                    features.append((f"b:{left}_{right}", 0.7))
            if not features:
                continue
            counts: dict[str, float] = {}
            for feature, weight in features:
                counts[feature] = counts.get(feature, 0.0) + weight
            for feature, count in counts.items():
                digest = hashlib.blake2b(feature.encode("utf-8"), digest_size=8).digest()
                bucket = int.from_bytes(digest[:4], "little") % self.dimension
                sign = -1.0 if digest[4] & 1 else 1.0
                vectors[row, bucket] += sign * (1.0 + math.log(count))
        return _normalise(vectors)

    @staticmethod
    def _char_ngrams(token: str, n: int) -> list[str]:
        padded = f"^{token}$"
        if len(padded) <= n:
            return [padded]
        return [padded[i : i + n] for i in range(len(padded) - n + 1)]


class SentenceTransformerEmbedder:
    def __init__(self, model_name: str):
        from sentence_transformers import SentenceTransformer  # type: ignore

        self.backend = "sentence-transformers"
        self.model_name = model_name
        self.model = SentenceTransformer(model_name, device="cpu")
        self.dimension = int(self.model.get_sentence_embedding_dimension() or 768)

    def embed(self, texts: Sequence[str]) -> np.ndarray:
        vectors = self.model.encode(
            list(texts),
            batch_size=get_settings().embedding_batch_size,
            show_progress_bar=False,
            convert_to_numpy=True,
            normalize_embeddings=True,
        )
        return np.asarray(vectors, dtype=np.float32)


class EmbeddingService:
    def __init__(self):
        self.settings = get_settings()
        self._lock = threading.Lock()
        self._embedder: HashEmbedder | SentenceTransformerEmbedder | None = None
        self._attempted = False
        self.fallback_reason: str | None = None

    def _load(self) -> None:
        if self._embedder is not None:
            return
        with self._lock:
            if self._embedder is not None:
                return
            requested = self.settings.embedding_backend
            if requested in {"auto", "sentence-transformers"}:
                try:
                    self._embedder = SentenceTransformerEmbedder(self.settings.embedding_model)
                    logger.info("Loaded embedding model %s", self.settings.embedding_model)
                    return
                except Exception as exc:  # model missing, offline, no torch, etc.
                    self.fallback_reason = str(exc)
                    logger.warning(
                        "Sentence-transformer unavailable; using offline hash embeddings: %s",
                        exc,
                    )
                    if requested == "sentence-transformers":
                        raise RuntimeError(
                            "HELIUM_EMBEDDING_BACKEND=sentence-transformers but the model could "
                            f"not be loaded: {exc}"
                        ) from exc
            self._embedder = HashEmbedder(self.settings.embedding_dimension)
            self._attempted = True

    @property
    def backend(self) -> str:
        self._load()
        assert self._embedder is not None
        return self._embedder.backend

    @property
    def model_name(self) -> str:
        self._load()
        assert self._embedder is not None
        return self._embedder.model_name

    @property
    def dimension(self) -> int:
        self._load()
        assert self._embedder is not None
        return self._embedder.dimension

    def embed_texts(self, texts: Sequence[str]) -> np.ndarray:
        self._load()
        assert self._embedder is not None
        if not texts:
            return np.zeros((0, self._embedder.dimension), dtype=np.float32)
        vectors = self._embedder.embed(texts)
        return np.asarray(vectors, dtype=np.float32)

    def embed_query(self, query: str) -> np.ndarray:
        return self.embed_texts([query])[0]

    def status(self) -> dict[str, Any]:
        self._load()
        assert self._embedder is not None
        return {
            "backend": self._embedder.backend,
            "model": self._embedder.model_name,
            "dimension": self._embedder.dimension,
            "fallback_reason": self.fallback_reason,
        }


class IndexManager:
    """Thread-safe FAISS inner-product index mirrored to disk."""

    def __init__(
        self,
        *,
        uid: str | None = None,
        repository: Repository | None = None,
        embedder: EmbeddingService | None = None,
    ):
        self.uid = uid or "local"
        self.settings = get_settings()
        self.repository = repository or get_repository(self.uid)
        self.embedder = embedder or EmbeddingService()
        # Only the default "local" user persists the FAISS file to disk; per-user
        # indices stay in memory so they never clobber the shared index file.
        self._should_persist = self.uid == "local"
        self._lock = threading.RLock()
        self.ids: list[str] = []
        self._vectors: np.ndarray | None = None
        self._index: Any = None
        self._loaded = False
        self._faiss = None
        try:
            import faiss  # type: ignore

            self._faiss = faiss
        except Exception:
            self._faiss = None

    @property
    def index_type(self) -> str:
        return "faiss" if self._faiss is not None else "numpy"

    def startup(self) -> None:
        with self._lock:
            if self._loaded:
                return
            if self._try_load_persisted():
                self._loaded = True
                return
            self.rebuild()
            self._loaded = True

    def _try_load_persisted(self) -> bool:
        if not self._should_persist:
            return False
        meta_path = self.settings.index_meta_path
        index_path = self.settings.index_path
        if self._faiss is None or not meta_path.exists() or not index_path.exists():
            return False
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            ids = meta.get("ids", [])
            if not ids or int(meta.get("count", 0)) != len(ids):
                return False
            if self.repository.count_chunks() != len(ids):
                return False
            index = self._faiss.read_index(str(index_path))
            if int(index.ntotal) != len(ids):
                return False
            self.ids = list(ids)
            self._index = index
            self._index_type_persisted = meta.get("index_type", "faiss")
            return True
        except Exception as exc:
            logger.warning("Could not load persisted FAISS index; rebuilding: %s", exc)
            return False

    def rebuild(self) -> None:
        with self._lock:
            rows = self.repository.all_embedding_rows()
            if not rows:
                self.ids = []
                self._vectors = None
                self._index = None
                self._persist()
                return
            vectors: list[np.ndarray] = []
            ids: list[str] = []
            dimension: int | None = None
            for row in rows:
                blob = row.get("embedding")
                if not blob:
                    continue
                vector = np.frombuffer(blob, dtype=np.float32).copy()
                if dimension is None:
                    dimension = int(vector.shape[0])
                if vector.shape[0] != dimension:
                    continue
                vectors.append(vector)
                ids.append(row["id"])
            if not ids or dimension is None:
                self.ids = []
                self._vectors = None
                self._index = None
                self._persist()
                return
            matrix = _normalise(np.vstack(vectors).astype(np.float32))
            self.ids = ids
            self._vectors = matrix
            if self._faiss is not None:
                index = self._faiss.IndexFlatIP(dimension)
                index.add(matrix)
                self._index = index
            else:
                self._index = None
            self._persist()

    def add(self, ids: list[str], vectors: np.ndarray) -> None:
        if not ids:
            return
        matrix = np.asarray(vectors, dtype=np.float32)
        if matrix.ndim != 2 or matrix.shape[0] != len(ids):
            raise ValueError("Embedding matrix does not match chunk IDs")
        matrix = _normalise(matrix)
        with self._lock:
            if not self._loaded:
                self.startup()
            # When the process loaded a persisted FAISS file we do not keep a
            # duplicate dense matrix in memory. Rebuild from SQLite (the source
            # of truth) before appending the newly ingested chunks.
            if self._vectors is None and self.ids:
                self.rebuild()
                return
            if self._vectors is not None and self._vectors.shape[1] != matrix.shape[1]:
                raise RuntimeError(
                    "Embedding dimension changed. Delete and re-index documents, or restore the "
                    "original embedding model."
                )
            self.ids.extend(ids)
            if self._vectors is None:
                self._vectors = matrix
            else:
                self._vectors = np.vstack([self._vectors, matrix])
            if self._faiss is not None:
                if self._index is None:
                    self._index = self._faiss.IndexFlatIP(matrix.shape[1])
                self._index.add(matrix)
            self._persist()

    def search(
        self, query_vector: np.ndarray, k: int
    ) -> list[tuple[str, float]]:
        with self._lock:
            if not self._loaded:
                self.startup()
            if not self.ids:
                return []
            vector = np.asarray(query_vector, dtype=np.float32).reshape(1, -1)
            vector = _normalise(vector)
            if self._vectors is not None and vector.shape[1] != self._vectors.shape[1]:
                raise RuntimeError(
                    "Query embedding dimension does not match the index. Check "
                    "HELIUM_EMBEDDING_MODEL or re-index the document corpus."
                )
            k = max(1, min(int(k), len(self.ids)))
            if self._faiss is not None and self._index is not None:
                scores, indices = self._index.search(vector, k)
                return [
                    (self.ids[int(index)], float(score))
                    for score, index in zip(scores[0], indices[0])
                    if int(index) >= 0
                ]
            assert self._vectors is not None
            similarities = self._vectors @ vector[0]
            top = np.argsort(-similarities)[:k]
            return [(self.ids[int(i)], float(similarities[int(i)])) for i in top]

    def _persist(self) -> None:
        if not self._should_persist:
            return
        self.settings.data_dir.mkdir(parents=True, exist_ok=True)
        meta = {
            "ids": self.ids,
            "count": len(self.ids),
            "dimension": int(self._vectors.shape[1]) if self._vectors is not None else 0,
            "index_type": self.index_type,
            "embedding_backend": self.embedder.backend,
            "embedding_model": self.embedder.model_name,
        }
        if self._faiss is not None and self._index is not None:
            temp_path = self.settings.index_path.with_suffix(".index.tmp")
            self._faiss.write_index(self._index, str(temp_path))
            os.replace(temp_path, self.settings.index_path)
        elif self._vectors is not None:
            np.save(self.settings.index_path.with_suffix(".npy"), self._vectors)
        temp_meta = self.settings.index_meta_path.with_suffix(".json.tmp")
        temp_meta.write_text(json.dumps(meta, separators=(",", ":")), encoding="utf-8")
        os.replace(temp_meta, self.settings.index_meta_path)

    def remove_document(self) -> None:
        """Rebuild after a source document is deleted."""
        self.rebuild()

    def status(self) -> dict[str, Any]:
        with self._lock:
            if not self._loaded:
                self.startup()
            return {
                "status": "active" if self.ids else "empty",
                "vectors": len(self.ids),
                "dimension": (
                    int(self._vectors.shape[1])
                    if self._vectors is not None
                    else int(getattr(self._index, "d", 0) or 0)
                ),
                "index_type": self.index_type,
                "embedding": self.embedder.status(),
                "persisted": self._should_persist and self.settings.index_path.exists(),
                "path": str(self.settings.index_path),
            }


_embedder: EmbeddingService | None = None
_indices: dict[str, IndexManager] = {}


def get_embedder() -> EmbeddingService:
    global _embedder
    if _embedder is None:
        _embedder = EmbeddingService()
    return _embedder


def get_index(uid: str | None = None) -> IndexManager:
    key = uid or "local"
    global _indices
    if key not in _indices:
        _indices[key] = IndexManager(uid=key, embedder=get_embedder())
    return _indices[key]
