"""Document parsing, boilerplate removal, and semantic chunking.

The parser keeps physical location metadata (page and section) attached to every
chunk. It is deliberately tolerant of missing optional parser dependencies so
TXT ingestion still works in a minimal installation, while PDF/DOCX support is
enabled automatically when their libraries are present.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Iterable

from ..utils import normalize_whitespace, split_sentences, token_count

PAGE_NUMBER_PATTERNS = (
    re.compile(r"^\s*(?:page|p\.)\s*\d+(?:\s*(?:of|/)\s*\d+)?\s*$", re.I),
    re.compile(r"^\s*\d+\s*(?:of|/)\s*\d+\s*$", re.I),
    re.compile(r"^\s*[-–—]?\s*\d{1,4}\s*[-–—]?\s*$"),
)
LEGAL_BOILERPLATE = re.compile(
    r"(all rights reserved|confidential(?: and proprietary)?|internal use only|"
    r"proprietary and confidential|uncontrolled (?:when|if) printed|"
    r"this (?:document|policy) is (?:provided|intended)|terms and conditions apply|"
    r"for internal distribution only|do not distribute|copyright ©|©\s*\d{4})",
    re.I,
)
HEADING_NUMBERED = re.compile(
    r"^(?:section|article|part|chapter)\s+\d+(?:\.\d+)*[.:)]?\s+\S|"
    r"^\d+(?:\.\d+){0,3}[.)]?\s+[A-Z][^.!?]{2,90}$",
    re.I,
)
METADATA_LINE = re.compile(
    r"^(?:effective|revision|version|issued|updated|revised|prepared|approved|owner|"
    r"department|classification|document\s*(?:id|number)|next\s+review|review\s+date|"
    r"date)\b[^.!?]{0,120}$",
    re.I,
)
MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec"
EFFECTIVE_DATE_RE = re.compile(
    rf"(?:effective|revised|updated|issued|version|revision)\s*(?:date)?\s*[:\-]?\s*"
    rf"((?:\d{{4}}-\d{{2}}-\d{{2}})|(?:\d{{1,2}}/\d{{1,2}}/\d{{4}})|"
    rf"(?:{MONTHS})\s+\d{{1,2}},?\s+\d{{4}}|(?:{MONTHS})\s+\d{{4}})",
    re.I,
)
YEAR_RE = re.compile(r"\b(20\d{2}|19\d{2})\b")


@dataclass
class TextBlock:
    page_number: int
    text: str
    section_heading: str | None = None


@dataclass
class ParsedDocument:
    blocks: list[TextBlock]
    page_count: int
    title: str
    doc_date: str | None = None
    metadata: dict[str, str] = field(default_factory=dict)


@dataclass
class ChunkDraft:
    text: str
    page_number: int
    section_heading: str | None
    chunk_index: int
    token_count: int


class DocumentParseError(RuntimeError):
    """Raised when a supported file cannot be parsed."""


class BoilerplateCleaner:
    """Removes repeated headers/footers, page numbers, and legal boilerplate."""

    def __init__(self, min_repeat_pages: int = 3, edge_lines: int = 4):
        self.min_repeat_pages = min_repeat_pages
        self.edge_lines = edge_lines

    def clean(self, pages: list[str]) -> list[str]:
        cleaned_pages = [normalize_whitespace(page) for page in pages]
        repeated = self._find_repeated_edge_lines(cleaned_pages)
        output: list[str] = []
        for page in cleaned_pages:
            lines = page.splitlines()
            kept: list[str] = []
            for index, line in enumerate(lines):
                stripped = line.strip()
                if not stripped:
                    kept.append("")
                    continue
                if any(pattern.match(stripped) for pattern in PAGE_NUMBER_PATTERNS):
                    continue
                if LEGAL_BOILERPLATE.search(stripped) and len(stripped) < 350:
                    continue
                near_edge = index < self.edge_lines or index >= len(lines) - self.edge_lines
                if near_edge and self._normalise_line(stripped) in repeated:
                    continue
                kept.append(stripped)
            output.append(normalize_whitespace("\n".join(kept)))
        return output

    def _find_repeated_edge_lines(self, pages: list[str]) -> set[str]:
        if len(pages) < self.min_repeat_pages:
            return set()
        counts: Counter[str] = Counter()
        edge_candidates: set[str] = set()
        for page in pages:
            lines = [line.strip() for line in page.splitlines() if line.strip()]
            edges = lines[: self.edge_lines] + lines[-self.edge_lines :]
            seen: set[str] = set()
            for line in edges:
                key = self._normalise_line(line)
                if 3 <= len(key) <= 180 and key not in seen:
                    counts[key] += 1
                    seen.add(key)
                    edge_candidates.add(key)
        threshold = max(self.min_repeat_pages, int(len(pages) * 0.55))
        return {line for line, count in counts.items() if count >= threshold}

    @staticmethod
    def _normalise_line(line: str) -> str:
        line = re.sub(r"\d+", "#", line.lower())
        line = re.sub(r"[^a-z# ]+", " ", line)
        return re.sub(r"\s+", " ", line).strip()


def _read_pdf(path: Path) -> tuple[list[str], dict[str, str]]:
    try:
        import pdfplumber  # type: ignore

        pages: list[str] = []
        metadata: dict[str, str] = {}
        with pdfplumber.open(str(path)) as pdf:
            metadata = {str(k): str(v) for k, v in (pdf.metadata or {}).items() if v}
            for page in pdf.pages:
                pages.append(page.extract_text(x_tolerance=2, y_tolerance=3) or "")
        if any(pages):
            return pages, metadata
    except ImportError:
        pass
    except Exception:
        # Fall through to pypdf, which handles some malformed files better.
        pass

    try:
        from pypdf import PdfReader  # type: ignore

        reader = PdfReader(str(path))
        pages = [(page.extract_text() or "") for page in reader.pages]
        metadata = {}
        if reader.metadata:
            metadata = {
                str(key).lstrip("/"): str(value)
                for key, value in reader.metadata.items()
                if value is not None
            }
        return pages, metadata
    except ImportError as exc:
        raise DocumentParseError(
            "PDF parsing requires pdfplumber or pypdf. Install backend requirements."
        ) from exc
    except Exception as exc:
        raise DocumentParseError(f"Could not read PDF: {exc}") from exc


def _read_docx(path: Path) -> tuple[list[str], dict[str, str]]:
    try:
        from docx import Document  # type: ignore
    except ImportError as exc:
        raise DocumentParseError(
            "DOCX parsing requires python-docx. Install backend requirements."
        ) from exc

    try:
        document = Document(str(path))
    except Exception as exc:
        raise DocumentParseError(f"Could not read DOCX: {exc}") from exc

    pages: list[str] = [""]
    current_page = 1
    heading = None
    for paragraph in document.paragraphs:
        text = normalize_whitespace(paragraph.text)
        style_name = (paragraph.style.name if paragraph.style else "").lower()
        is_heading = style_name.startswith("heading") or style_name == "title"
        if is_heading and text:
            heading = text
            pages[current_page - 1] += f"\n{text}\n"
        elif text:
            pages[current_page - 1] += f"\n{text}"
        # Respect explicit hard page breaks while reading paragraph XML.
        try:
            page_breaks = paragraph._p.xpath('.//w:br[@w:type="page"]')
        except Exception:
            page_breaks = []
        if page_breaks:
            current_page += 1
            pages.append(f"\n{heading}\n" if heading else "")

    for table in document.tables:
        rows: list[str] = []
        for row in table.rows:
            cells = [normalize_whitespace(cell.text) for cell in row.cells]
            if any(cells):
                rows.append(" | ".join(cells))
        if rows:
            pages[current_page - 1] += "\n" + "\n".join(rows)

    metadata: dict[str, str] = {}
    try:
        props = document.core_properties
        if props.title:
            metadata["title"] = props.title
        if props.subject:
            metadata["subject"] = props.subject
        if props.created:
            metadata["created"] = props.created.isoformat()
    except Exception:
        pass
    return pages, metadata


def _read_txt(path: Path) -> tuple[list[str], dict[str, str]]:
    raw = path.read_bytes()
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        text = raw.decode("utf-8", errors="replace")
    # Form feeds are a common page delimiter in extracted text.
    pages = text.split("\f")
    return pages, {}


def _guess_section_heading(text: str) -> str | None:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for line in lines[:5]:
        if len(line) > 120 or len(line) < 4:
            continue
        if HEADING_NUMBERED.match(line):
            return line.rstrip(".:")
        words = line.split()
        if (
            2 <= len(words) <= 12
            and not re.search(r"[.!?;:]$", line)
            and (line.isupper() or line.istitle())
            and sum(ch.isalpha() for ch in line) >= 4
        ):
            return line
    return None


def _parse_date(value: str) -> str | None:
    value = value.strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%B %d, %Y", "%b %d, %Y", "%B %Y", "%b %Y"):
        try:
            return datetime.strptime(value, fmt).date().isoformat()
        except ValueError:
            continue
    match = YEAR_RE.search(value)
    if match:
        return f"{match.group(1)}-01-01"
    return None


def infer_document_date(filename: str, text: str) -> str | None:
    match = EFFECTIVE_DATE_RE.search(text[:12000])
    if match:
        parsed = _parse_date(match.group(1))
        if parsed:
            return parsed
    # A year in the filename is a useful revision signal (e.g. Policy_2024.pdf).
    for match in YEAR_RE.finditer(filename):
        return f"{match.group(1)}-01-01"
    years = YEAR_RE.findall(text[:4000])
    if years:
        # Prefer the first explicit year in a title/version block.
        return f"{years[0]}-01-01"
    return None


def _looks_like_heading(line: str) -> bool:
    """Heuristic section-heading detector for extracted PDF/TXT lines."""

    stripped = line.strip()
    if not stripped or len(stripped) > 120 or len(stripped) < 3:
        return False
    if stripped[0] in "•-–—*|" or stripped.startswith(("•", "·")):
        return False
    words = stripped.split()
    if len(words) > 10:
        return False
    lower = stripped.lower()
    if re.match(
        r"^(?:effective|version|revision|date|prepared|approved|owner|department|"
        r"author|reviewed|next review|classification|document id)\b.*:",
        lower,
    ):
        return False
    if re.search(r"[.!?;]$", stripped):
        return False
    if re.search(r"\d{3,}", stripped):
        return False
    if HEADING_NUMBERED.match(stripped):
        return True
    if ":" in stripped:
        return False
    letters = [ch for ch in stripped if ch.isalpha()]
    if len(letters) < 4:
        return False
    if stripped.isupper() and 1 <= len(words) <= 10:
        return True
    # Title-case headings with common small words allowed. Require at least two
    # meaningful capitalised words to avoid treating a short body line as a title.
    small = {"a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to"}
    meaningful = [word for word in words if word.lower().strip("()[]") not in small]
    capitalised = [
        word
        for word in meaningful
        if word[:1].isupper() and any(ch.isalpha() for ch in word)
    ]
    if len(meaningful) >= 2 and len(capitalised) == len(meaningful):
        return True
    return False


def parse_document(path: Path, filename: str | None = None) -> ParsedDocument:
    filename = filename or path.name
    extension = path.suffix.lower()
    if extension == ".pdf":
        raw_pages, metadata = _read_pdf(path)
    elif extension == ".docx":
        raw_pages, metadata = _read_docx(path)
    elif extension == ".txt":
        raw_pages, metadata = _read_txt(path)
    else:
        raise DocumentParseError(f"Unsupported file type: {extension}")

    cleaner = BoilerplateCleaner()
    pages = cleaner.clean(raw_pages)
    blocks: list[TextBlock] = []
    for index, page in enumerate(pages, start=1):
        if not page.strip():
            continue
        lines = page.splitlines()
        current: list[str] = []
        current_heading: str | None = None
        for line in lines:
            stripped = line.strip()
            if _looks_like_heading(stripped):
                if current:
                    blocks.append(
                        TextBlock(
                            page_number=index,
                            section_heading=current_heading,
                            text="\n".join(current).strip(),
                        )
                    )
                    current = []
                current_heading = _clean_heading_text(stripped)
                continue
            current.append(line)
        if current:
            blocks.append(
                TextBlock(
                    page_number=index,
                    section_heading=current_heading,
                    text="\n".join(current).strip(),
                )
            )

    blocks = [block for block in blocks if block.text.strip()]
    if not blocks:
        raise DocumentParseError(
            "No readable text was found. The file may be scanned or image-only."
        )
    full_text = "\n".join(block.text for block in blocks)
    title = metadata.get("title") or Path(filename).stem.replace("_", " ").replace("-", " ")
    return ParsedDocument(
        blocks=blocks,
        page_count=max(1, len(pages)),
        title=title,
        doc_date=infer_document_date(filename, full_text),
        metadata=metadata,
    )


def _clean_heading_text(heading: str) -> str:
    value = re.sub(
        r"^(?:section|article|part|chapter)\s+\d+(?:\.\d+)*[.:)]?\s*",
        "",
        heading,
        flags=re.I,
    )
    value = re.sub(r"^\d+(?:\.\d+){0,3}[.)]?\s+", "", value)
    return value.strip(" .:-")


def _split_oversized_sentence(sentence: str, chunk_size: int) -> list[str]:
    words = sentence.split()
    if len(words) <= chunk_size:
        return [sentence]
    return [" ".join(words[i : i + chunk_size]) for i in range(0, len(words), chunk_size)]


def _metadata_only(text: str) -> bool:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return True
    substantive = [
        line
        for line in lines
        if not METADATA_LINE.match(line)
        and not re.fullmatch(r"[\d.\-–—/ ]+", line)
    ]
    return not substantive


def chunk_document(
    parsed: ParsedDocument,
    *,
    chunk_size: int = 512,
    overlap: int = 64,
) -> list[ChunkDraft]:
    """Slide a sentence-aware window over every parsed block.

    Chunks never intentionally split a sentence. The overlap is constructed from
    complete trailing sentences, so retrieval keeps context on both sides of a
    boundary without repeating half a clause.
    """

    chunk_size = max(64, int(chunk_size))
    overlap = min(max(0, int(overlap)), chunk_size - 16)
    drafts: list[ChunkDraft] = []
    global_index = 0

    for block in parsed.blocks:
        body = normalize_whitespace(block.text)
        if not body or _metadata_only(body):
            continue
        heading = block.section_heading
        body_sentences = split_sentences(body)
        if not body_sentences:
            continue

        current: list[str] = []
        current_tokens = 0
        for sentence in body_sentences:
            for piece in _split_oversized_sentence(sentence, chunk_size):
                piece_tokens = max(1, token_count(piece))
                if current and current_tokens + piece_tokens > chunk_size:
                    _emit_chunk(drafts, current, block, heading, global_index)
                    global_index += 1
                    current, current_tokens = _overlap_tail(current, overlap)
                current.append(piece)
                current_tokens += piece_tokens

        if current:
            _emit_chunk(drafts, current, block, heading, global_index)
            global_index += 1

    return drafts


def _overlap_tail(sentences: list[str], overlap_tokens: int) -> tuple[list[str], int]:
    if overlap_tokens <= 0:
        return [], 0
    tail: list[str] = []
    total = 0
    for sentence in reversed(sentences):
        count = max(1, token_count(sentence))
        if tail and total + count > overlap_tokens:
            break
        if not tail and count > overlap_tokens:
            # Do not begin a chunk with a giant partial sentence.
            break
        tail.insert(0, sentence)
        total += count
    return tail, total


def _emit_chunk(
    drafts: list[ChunkDraft],
    sentences: list[str],
    block: TextBlock,
    heading: str | None,
    index: int,
) -> None:
    body = " ".join(sentences).strip()
    if len(body) < 24 or token_count(body) < 4:
        return
    text = body
    if heading and not body.lower().startswith(heading.lower()):
        text = f"{heading}\n{body}"
    drafts.append(
        ChunkDraft(
            text=text,
            page_number=block.page_number,
            section_heading=heading,
            chunk_index=index,
            token_count=token_count(text),
        )
    )


def parse_and_chunk(
    path: Path,
    filename: str,
    *,
    chunk_size: int = 512,
    overlap: int = 64,
) -> tuple[ParsedDocument, list[ChunkDraft]]:
    parsed = parse_document(path, filename)
    return parsed, chunk_document(parsed, chunk_size=chunk_size, overlap=overlap)


def iter_sentences(text: str) -> Iterable[str]:
    yield from split_sentences(text)
