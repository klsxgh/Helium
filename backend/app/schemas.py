"""Pydantic request/response contracts for the Helium API."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

Relationship = Literal[
    "agreement",
    "contradiction",
    "conditional_conflict",
    "equivalence",
    "ambiguity",
]
Severity = Literal["critical", "high", "medium", "low", "info"]
Modality = Literal["must", "should", "may", "prohibited", "informational"]


class DocumentOut(BaseModel):
    id: str
    filename: str
    content_type: str = ""
    extension: str = ""
    size_bytes: int = 0
    version: int = 1
    status: str
    stage: str = ""
    progress: int = 0
    error: str | None = None
    chunk_count: int = 0
    page_count: int = 0
    doc_date: str | None = None
    uploaded_at: str
    processed_at: str | None = None


class DocumentList(BaseModel):
    documents: list[DocumentOut]
    stats: dict[str, Any]


class ChunkOut(BaseModel):
    id: str
    document_id: str
    chunk_index: int
    page_number: int
    section_heading: str | None = None
    text: str
    token_count: int
    filename: str
    doc_date: str | None = None
    uploaded_at: str
    version: int = 1


class UploadResult(BaseModel):
    documents: list[DocumentOut]
    duplicate: bool = False
    message: str


class ClaimOut(BaseModel):
    claim_id: str
    chunk_id: str
    document_id: str = ""
    entity: str
    subject: str = ""
    action: str = ""
    object: str = ""
    modality: Modality | str
    negation: bool = False
    numeric_constraints: list[str] = Field(default_factory=list)
    conditions: list[str] = Field(default_factory=list)
    raw_text: str
    confidence: float = 0.5
    source_filename: str = ""
    page_number: int = 1
    section_heading: str | None = None
    doc_date: str | None = None
    uploaded_at: str | None = None
    version: int = 1


class MismatchOut(BaseModel):
    field: str
    detail: str
    claim_a: Any = None
    claim_b: Any = None


class CitationOut(BaseModel):
    label: str
    chunk_id: str
    filename: str
    page_number: int = 1
    section_heading: str | None = None
    quote: str
    score: float = 0.0


class RelationshipOut(BaseModel):
    id: str
    query_id: str = ""
    relationship: Relationship | str
    severity: Severity | str
    confidence: float
    explanation: str
    mismatches: list[MismatchOut] = Field(default_factory=list)
    claim_a: ClaimOut
    claim_b: ClaimOut
    status: str = "open"
    resolution: str | None = None
    active_claim_id: str | None = None
    resolved_by: str | None = None
    resolution_note: str | None = None
    resolved_at: str | None = None
    created_at: str = ""
    query_text: str | None = None


class QueryRequest(BaseModel):
    query: str = Field(min_length=2, max_length=800)
    top_k: int = Field(default=8, ge=1, le=20)

    @field_validator("query")
    @classmethod
    def clean_query(cls, value: str) -> str:
        value = " ".join(value.strip().split())
        if not value:
            raise ValueError("Query cannot be empty")
        return value


class MetricsOut(BaseModel):
    retrieval_ms: float = 0.0
    analysis_ms: float = 0.0
    generation_ms: float = 0.0
    total_ms: float = 0.0
    top_k: int = 8
    retrieved_chunks: int = 0
    claims_analyzed: int = 0
    pairs_analyzed: int = 0
    embedding_backend: str = "hash"
    embedding_model: str = ""
    index_type: str = "faiss"
    generation_backend: str = "extractive"


class QueryResult(BaseModel):
    query_id: str
    query: str
    answer: str
    citations: list[CitationOut] = Field(default_factory=list)
    claims: list[ClaimOut] = Field(default_factory=list)
    relationships: list[RelationshipOut] = Field(default_factory=list)
    conflicts: list[RelationshipOut] = Field(default_factory=list)
    metrics: MetricsOut
    consistency_score: int = 100
    chunks_analyzed: int = 0
    created_at: str = ""


class HistoryItem(BaseModel):
    id: str
    query: str
    consistency_score: int
    chunks_analyzed: int
    issue_count: int = 0
    contradiction_count: int = 0
    pair_count: int = 0
    created_at: str


class ScanRequest(BaseModel):
    document_ids: list[str] = Field(min_length=2, max_length=50)


class ScanResult(BaseModel):
    scan_id: str
    query: str = ""
    document_ids: list[str] = Field(default_factory=list)
    document_names: list[str] = Field(default_factory=list)
    relationships: list[RelationshipOut] = Field(default_factory=list)
    conflicts: list[RelationshipOut] = Field(default_factory=list)
    counts: dict[str, int] = Field(default_factory=dict)
    claims_analyzed: int = 0
    pairs_analyzed: int = 0
    chunks_analyzed: int = 0
    consistency_score: int = 100
    created_at: str = ""
    metrics: dict[str, Any] = Field(default_factory=dict)


class ResolveConflictRequest(BaseModel):
    action: Literal[
        "accept_newest",
        "keep_current",
        "flag_review",
        "mark_false_positive",
        "reopen",
    ]
    reviewer: str = Field(default="Compliance Reviewer", min_length=1, max_length=120)
    note: str | None = Field(default=None, max_length=2000)


class HealthOut(BaseModel):
    status: str
    app: str
    version: str
    index: dict[str, Any]
    stats: dict[str, Any]
    capabilities: dict[str, Any]


class SeedResult(BaseModel):
    documents: list[DocumentOut]
    message: str
