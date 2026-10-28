# Helium

Helium is a contradiction-aware retrieval-augmented generation (RAG) workspace for policy documents. It answers questions from your own PDF, DOCX, and TXT files, cites the passages supporting each answer, extracts structured claims, and reports where those claims disagree instead of silently averaging the disagreement away.

The interface is a split workspace: a source library, a grounded chat, and a consistency inspector. A first-run product tour introduces every area, and Settings can replay it at any time.

## Highlights

- **Grounded answers with citations** — every answer is constrained to retrieved evidence and includes source-level citation pills.
- **Claim-level analysis** — entities, modality, negation, numbers, dates, conditions, and citation references are extracted from retrieved passages.
- **Five relationship types** — Agreement, Contradiction, Conditional Conflict, Equivalence, and Ambiguity.
- **Explainable conflicts** — paired claims, source dates, severity, confidence, and a reason for the relationship.
- **Reviewer workflow** — accept the newest source, keep the current source, flag, mark a false positive, or reopen a conflict.
- **Cross-document scan** — select any two or more sources and compare every claim between them, listing contradictions, conditional conflicts, ambiguities, and agreements with no question required.
- **Persistent workspace** — SQLite stores documents, chunks, claims, query reports, and conflicts. FAISS stores the vector index and can be rebuilt.
- **Graceful local fallbacks** — deterministic hash embeddings and a blank spaCy pipeline keep the app usable when the optional ML stack is not installed.
- **Dark and light themes**, responsive mobile panes, and a guided first-run tour.

## Architecture

```text
┌──────────────────────────────┐
│ Next.js 14 / Tailwind        │
│ Sources · Chat · Inspector   │
│ Review drawer · Settings     │
└──────────────┬───────────────┘
               │ /api (Next rewrite in dev and Docker)
┌──────────────▼───────────────┐
│ FastAPI                      │
│ ingest · query · review      │
│ SSE streaming                │
└───────┬──────────────┬───────┘
        │              │
┌───────▼──────┐ ┌─────▼──────────────┐
│ SQLite       │ │ FAISS index        │
│ metadata,    │ │ dense vectors      │
│ claims,      │ │ persisted on disk  │
│ reports      │ └────────────────────┘
└──────────────┘
```

The backend uses:

- Python 3.11+, FastAPI, Pydantic, Uvicorn
- spaCy for sentence structure and lightweight entity/rule extraction
- `sentence-transformers/all-mpnet-base-v2` when available, with a deterministic 768-dimensional hash embedder as a fallback
- FAISS (`IndexFlatIP`) with a NumPy fallback
- SQLite for durable metadata and reports
- Optional local Hugging Face generation, disabled by default; extractive grounded synthesis is the default

## Quick start

### Prerequisites

- Python 3.11 or newer
- Node.js 20 or newer
- npm 10 or newer

### 1. Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Optional: local transformer embeddings + local generation stack.
pip install -r requirements-ml.txt
python -m spacy download en_core_web_sm

uvicorn app.main:app --reload --port 8000
```

On macOS/Linux, activate with `source .venv/bin/activate`.

If you do not install `requirements-ml.txt` or the spaCy model, Helium still starts:

- embeddings use the built-in hash backend
- claim extraction uses a blank spaCy pipeline plus the rule-based extractor

Open `http://127.0.0.1:8000/docs` for the generated API documentation. The health endpoint is `http://127.0.0.1:8000/api/health`.

### 2. Frontend

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`.

The Next.js app proxies `/api/*` to `http://127.0.0.1:8000` by default. Override the backend target with:

```powershell
$env:BACKEND_INTERNAL_URL="http://127.0.0.1:8000"
npm run dev
```

### 3. Try the demo

1. On first launch, the product tour opens automatically.
2. In the Sources pane, choose **Load demo corpus**.
3. Ask one of the suggested questions, such as **Are remote employees required to use company-issued devices?**
4. Open the Report pane to compare the conflicting claims.
5. Open **Review** to record a reviewer decision.
6. Open **Settings** (gear) to change the theme, evidence depth, reviewer name, or replay the tour.

The demo corpus contains three policies with deliberate disagreements. No data leaves your machine.

## Configuration

Backend configuration is environment-driven. See [`backend/.env.example`](backend/.env.example) for the full list.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HELIUM_DATA_DIR` | `backend/data` | SQLite, uploads, FAISS index, and metadata |
| `HELIUM_DB_PATH` | `<data>/helium.sqlite3` | SQLite database location |
| `HELIUM_INDEX_PATH` | `<data>/faiss.index` | FAISS index location |
| `HELIUM_CORS_ORIGINS` | localhost:3000 | Comma-separated allowed browser origins |
| `HELIUM_TOP_K` | `8` | Default evidence passages per query |
| `HELIUM_CHUNK_SIZE` | `512` | Approximate tokens per chunk |
| `HELIUM_CHUNK_OVERLAP` | `64` | Chunk overlap |
| `HELIUM_MAX_UPLOAD_MB` | `50` | Maximum size per file |
| `HELIUM_MAX_FILES` | `50` | Maximum files per batch |
| `HELIUM_EMBEDDING_BACKEND` | `auto` | `auto`, `sentence-transformers`, or `hash` |
| `HELIUM_EMBEDDING_MODEL` | `all-mpnet-base-v2` | Sentence-transformers model |
| `HELIUM_SPACY_MODEL` | `en_core_web_sm` | spaCy pipeline |
| `HELIUM_ENABLE_LLM` | `0` | Enable optional local Hugging Face generation |
| `HELIUM_SEED_DEMO` | `0` | Seed the demo corpus on startup |

Frontend variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `BACKEND_INTERNAL_URL` | `http://127.0.0.1:8000` | Server-side rewrite target for `/api` |

## How a query works

1. The question is embedded and used to retrieve the top `k` chunks from FAISS.
2. The retriever prioritizes on-topic evidence and expands to neighboring chunks when useful.
3. Sentences are extracted into structured claims: entity, action, object, modality, negation, numeric constraints, dates, conditions, and citations.
4. Candidate claim pairs are compared with deterministic rule signals and lexical similarity.
5. Each pair receives a relationship, severity, confidence, and human-readable explanation.
6. The answer generator produces a grounded response with citation markers, plus a Contradiction & Consistency Report payload.
7. The full report, conflicts, citations, and timings are persisted and can be reopened from History.
8. Reviewer decisions update the conflict status with the reviewer name and note.

Low-confidence pairs are reported as **Ambiguity**, not asserted as contradictions.

## API summary

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Service, index, and repository health |
| `GET` | `/api/config` | Public runtime configuration |
| `POST` | `/api/ingest` | Upload up to 50 PDF/DOCX/TXT files |
| `GET` | `/api/documents` | List documents and indexing state |
| `DELETE` | `/api/documents/{id}` | Delete a document and rebuild the index |
| `POST` | `/api/documents/{id}/reindex` | Re-parse and re-index a document |
| `GET` | `/api/documents/{id}/chunks` | Inspect document chunks |
| `GET` | `/api/chunks/{id}` | Fetch a full chunk for the citation viewer |
| `POST` | `/api/demo/seed` | Load the demonstration corpus |
| `GET` | `/api/index/status` | Inspect vector index health |
| `POST` | `/api/query` | Ask a question |
| `POST` | `/api/query/stream` | Stream status, analysis, answer deltas, and completion |
| `GET` | `/api/history` | Recent query history |
| `GET` | `/api/history/{id}` | Reopen a saved query report |
| `GET` | `/api/admin/conflicts` | List relationship records for review |
| `POST` | `/api/admin/conflicts/{id}/resolve` | Apply a reviewer action |
| `POST` | `/api/scan` | Compare the selected documents and list contradictions between them |
| `GET` | `/api/scan/{id}` | Reopen a saved cross-document scan |
| `GET` | `/api/admin/stats` | Repository and review counters |

SSE event types: `status`, `analysis`, `delta`, `complete`, `error`.

## Reviewer actions

| Action | Effect |
| --- | --- |
| `accept_newest` | Marks the relationship resolved with the newest source as controlling |
| `keep_current` | Marks the relationship resolved with the current source as controlling |
| `flag_review` | Moves the conflict into the flagged queue |
| `mark_false_positive` | Resolves the relationship as a false positive |
| `reopen` | Returns a resolved conflict to the open queue |

Newest-source ordering uses document date first, then upload time, then version. Deleting a document retains historical query reports; the report remains readable, while its chunks are removed.

## Tests

Run the backend integration suite from the repository root:

```powershell
pip install -r backend/requirements-dev.txt
python -m unittest discover -s backend/tests -t backend -v
```

The suite uses an isolated temporary data directory and hash embeddings. It covers health, seeded documents, contradiction detection, on-topic claim filtering, reviewer actions, chunk detail, history, and stream helpers.

Frontend checks:

```powershell
cd frontend
npm run typecheck
npm run build
```

## Docker

The repository includes a production-style Compose stack.

```powershell
docker compose up --build
```

Open `http://localhost:3000`. The API is exposed at `http://localhost:8000`.

- SQLite, uploads, and the FAISS index live in the `helium-data` volume.
- The backend image installs the optional ML stack by default (`INSTALL_ML=1`). The embedding model is downloaded on first use; allow network access for that first run, or build with `INSTALL_ML=0` to use the hash fallback.
- The frontend is built as a Next.js standalone server and proxies `/api` to the backend service.
- Set `HELIUM_SEED_DEMO=1` in `.env` to seed the demo corpus on first boot.

Copy `.env.example` to `.env` to override defaults.

## Repository layout

```text
helium/
├── backend/
│   ├── app/
│   │   ├── main.py            # FastAPI app, lifespan, health
│   │   ├── config.py          # environment-driven settings
│   │   ├── db.py              # SQLite repository and migrations
│   │   ├── schemas.py         # API schemas
│   │   ├── routers/           # ingest, query, admin
│   │   └── services/          # parser, chunker, embeddings, reasoning, generator
│   ├── tests/                 # standard-library integration tests
│   ├── requirements.txt
│   ├── requirements-ml.txt
│   └── Dockerfile
├── frontend/
│   ├── src/app/               # Next.js app router
│   ├── src/components/        # workspace, inspector, review, tour, settings
│   ├── src/lib/               # typed API client and helpers
│   ├── Dockerfile
│   └── package.json
├── docker-compose.yml
├── .env.example
└── README.md
```

## Operational notes

- **Data directory**: the only stateful directory is `HELIUM_DATA_DIR`. Back it up to preserve documents and reports.
- **Index recovery**: if the FAISS file is missing or incompatible, Helium rebuilds it from stored chunk embeddings.
- **Upload limits**: 50 MB per file and 50 files per batch by default.
- **Supported formats**: text-based PDF, DOCX, and UTF-8-compatible TXT. Scanned PDFs require OCR and are not supported out of the box.
- **LLM opt-in**: local generation is deliberately disabled by default so the app can run offline with extractive answers and no model download.
- **Embedding fallback**: hash embeddings are deterministic and fully local, but they are a fallback rather than a substitute for a trained sentence-transformer. The active backend is visible in Settings → Technical details.

## Security and privacy

- Uploaded content stays in the configured data directory and is sent only to the local backend.
- CORS is restricted to configured origins.
- Reviewer identity is user-supplied and stored on the conflict record they resolve.
- The app has no authentication layer. Put it behind your organization’s SSO/reverse proxy before exposing it to a network.
- Do not put secrets in `NEXT_PUBLIC_*` variables; the frontend intentionally only talks to its own `/api` route.

## Troubleshooting

**The frontend says “API unreachable”.**
Start the backend on port 8000 and verify `http://127.0.0.1:8000/api/health`. If you changed the port, set `BACKEND_INTERNAL_URL` before building or starting the frontend.

**Uploads fail for PDF or DOCX.**
Install the backend requirements again. `pypdf`, `pdfplumber`, and `python-docx` are required for those formats. TXT ingestion works without them.

**Embeddings say “hash”.**
This is expected when `torch`/`sentence-transformers` or the configured model is unavailable. Install `requirements-ml.txt` and restart the backend, or keep the fallback for a small offline deployment.

**The tour opens every time.**
Local storage is blocked by the browser or an extension. Allow site storage, or complete the tour once. The completion key is `helium-tour-completed-v1`.

**Review queue is empty while a report shows a conflict.**
The queue defaults to **Open** workspace issues. A conflict may already be resolved or marked as a false positive; use the **Resolved** or **All** filters.

## Limitations

- Contradiction detection is rule- and similarity-based, not a formal logic prover. Review decisions are the source of truth.
- The extractive fallback is intentionally conservative and does not write fluent free-form prose.
- No OCR, table extraction tuning, authentication, or multi-tenant isolation is included.
- The demo corpus is synthetic and is not legal or HR advice.
