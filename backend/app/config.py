"""Application configuration for Helium.

All settings are intentionally environment-driven so the same image can run in
local development, Docker, or an air-gapped inference environment.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int, minimum: int | None = None) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        value = default
    if minimum is not None:
        value = max(minimum, value)
    return value


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    app_name: str = "Helium"
    app_version: str = "1.0.0"
    environment: str = "development"
    api_prefix: str = "/api"
    data_dir: Path = BACKEND_DIR / "data"
    upload_dir: Path = BACKEND_DIR / "data" / "uploads"
    db_path: Path = BACKEND_DIR / "data" / "helium.sqlite3"
    index_path: Path = BACKEND_DIR / "data" / "faiss.index"
    index_meta_path: Path = BACKEND_DIR / "data" / "faiss.meta.json"

    embedding_model: str = "sentence-transformers/all-mpnet-base-v2"
    embedding_backend: str = "auto"  # auto | sentence-transformers | hash
    embedding_batch_size: int = 32
    embedding_dimension: int = 768

    spacy_model: str = "en_core_web_sm"
    default_chunk_size: int = 512
    default_chunk_overlap: int = 64
    max_upload_mb: int = 50
    max_files_per_upload: int = 50
    retrieval_top_k: int = 8
    max_claims_per_chunk: int = 6

    llm_enabled: bool = False
    llm_model: str = "microsoft/Phi-3-mini-4k-instruct"
    llm_max_new_tokens: int = 512
    llm_temperature: float = 0.15
    llm_device: str = "cpu"

    demo_seed: bool = False
    cors_origins: tuple[str, ...] = (
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    )
    reviewer_default: str = "Compliance Reviewer"

    @classmethod
    def from_env(cls) -> "Settings":
        default_data_dir = (
            "/tmp/helium-data"
            if os.getenv("VERCEL")
            else str(BACKEND_DIR / "data")
        )
        data_dir = Path(os.getenv("HELIUM_DATA_DIR", default_data_dir)).expanduser().resolve()
        upload_dir = Path(os.getenv("HELIUM_UPLOAD_DIR", str(data_dir / "uploads"))).expanduser().resolve()
        db_path = Path(os.getenv("HELIUM_DB_PATH", str(data_dir / "helium.sqlite3"))).expanduser().resolve()
        index_path = Path(os.getenv("HELIUM_INDEX_PATH", str(data_dir / "faiss.index"))).expanduser().resolve()
        origins = tuple(
            origin.strip()
            for origin in os.getenv(
                "HELIUM_CORS_ORIGINS",
                "*" if os.getenv("VERCEL") else "http://localhost:3000,http://127.0.0.1:3000",
            ).split(",")
            if origin.strip()
        )
        return cls(
            environment=os.getenv("HELIUM_ENV", "development"),
            data_dir=data_dir,
            upload_dir=upload_dir,
            db_path=db_path,
            index_path=index_path,
            index_meta_path=data_dir / "faiss.meta.json",
            embedding_model=os.getenv(
                "HELIUM_EMBEDDING_MODEL", "sentence-transformers/all-mpnet-base-v2"
            ),
            embedding_backend=os.getenv("HELIUM_EMBEDDING_BACKEND", "auto").lower(),
            embedding_batch_size=_env_int("HELIUM_EMBEDDING_BATCH_SIZE", 32, 1),
            embedding_dimension=_env_int("HELIUM_EMBEDDING_DIM", 768, 32),
            spacy_model=os.getenv("HELIUM_SPACY_MODEL", "en_core_web_sm"),
            default_chunk_size=_env_int("HELIUM_CHUNK_SIZE", 512, 64),
            default_chunk_overlap=_env_int("HELIUM_CHUNK_OVERLAP", 64, 0),
            max_upload_mb=_env_int("HELIUM_MAX_UPLOAD_MB", 50, 1),
            max_files_per_upload=_env_int("HELIUM_MAX_FILES", 50, 1),
            retrieval_top_k=_env_int("HELIUM_TOP_K", 8, 1),
            max_claims_per_chunk=_env_int("HELIUM_MAX_CLAIMS", 6, 1),
            llm_enabled=_env_bool("HELIUM_ENABLE_LLM", False),
            llm_model=os.getenv("HELIUM_LLM_MODEL", "microsoft/Phi-3-mini-4k-instruct"),
            llm_max_new_tokens=_env_int("HELIUM_LLM_MAX_NEW_TOKENS", 512, 64),
            llm_temperature=_env_float("HELIUM_LLM_TEMPERATURE", 0.15),
            llm_device=os.getenv("HELIUM_LLM_DEVICE", "cpu"),
            demo_seed=_env_bool("HELIUM_SEED_DEMO", False),
            cors_origins=origins,
            reviewer_default=os.getenv("HELIUM_DEFAULT_REVIEWER", "Compliance Reviewer"),
        )

    def ensure_directories(self) -> None:
        try:
            self.data_dir.mkdir(parents=True, exist_ok=True)
            self.upload_dir.mkdir(parents=True, exist_ok=True)
        except OSError:
            # On read-only serverless filesystems, fall back to /tmp.
            fallback = Path("/tmp/helium-data")
            self.data_dir = fallback
            self.upload_dir = fallback / "uploads"
            fallback.mkdir(parents=True, exist_ok=True)
            self.upload_dir.mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings.from_env()
    settings.ensure_directories()
    return settings


ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt"}
