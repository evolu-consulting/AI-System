"""Business and technical documents as text the agents can read: PDF and Word (.docx) to markdown.

The documents a flow needs (contract types, legal rules, payment processes, sample test cases ...) arrive as PDF
and Word files; the line reads .md / .txt only. This module turns them into markdown once, where they enter:

    convert(path)              -> Doc(name, text, kind, pages, warnings)   a file on disk
    convert_bytes(name, data)  -> Doc                                      an upload (POST /api/docs:convert)
    readable(name)             -> True for .pdf / .docx (what convert takes)

    PDF    pypdf text extraction page by page ("## Page n" headings); a page with no text layer (a scan) is named
           in warnings; no OCR. A PDF with no text at all raises DocError (nothing an agent could read).
    DOCX   stdlib only (zip + XML): headings (Heading n / Title styles) as #, lists as -, tables as markdown
           tables, line breaks and tabs kept; images and drawings are named in warnings.
    .doc   (Word 97-2003) is refused: save it as .docx or PDF first.

`dlc doc <file>` prints the markdown (the agents' read_document tool and a person's check use the same code).
"""

from __future__ import annotations

import io
import os
import re
import zipfile
from dataclasses import dataclass, field
from typing import List, Optional
from xml.etree import ElementTree as ET

KINDS = (".pdf", ".docx")
MAX_BYTES = 40 * 1024 * 1024          # one document; larger ones are refused
MAX_CHARS = 1_500_000                 # text kept from one document
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


class DocError(ValueError):
    """The document cannot be read (wrong type, broken, encrypted, no text)."""


@dataclass
class Doc:
    name: str
    text: str
    kind: str
    pages: int = 0
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"name": self.name, "kind": self.kind, "pages": self.pages, "chars": len(self.text),
                "warnings": self.warnings, "text": self.text}


def readable(name: str) -> bool:
    return os.path.splitext(name or "")[1].lower() in KINDS


def md_name(name: str) -> str:
    """The .md file a converted document is kept as: 'Hop dong.pdf' -> 'Hop dong.pdf.md'."""
    return os.path.basename(name) + ".md"


def convert(path: str) -> Doc:
    if not os.path.isfile(path):
        raise DocError("no such file: %s" % path)
    if os.path.getsize(path) > MAX_BYTES:
        raise DocError("%s is larger than %d MB" % (os.path.basename(path), MAX_BYTES // (1024 * 1024)))
    with open(path, "rb") as fh:
        return convert_bytes(os.path.basename(path), fh.read())


def convert_bytes(name: str, data: bytes) -> Doc:
    ext = os.path.splitext(name or "")[1].lower()
    if len(data) > MAX_BYTES:
        raise DocError("%s is larger than %d MB" % (name, MAX_BYTES // (1024 * 1024)))
    if ext == ".doc":
        raise DocError("%s is an old Word file (.doc): save it as .docx or PDF first" % name)
    if ext == ".pdf":
        doc = _pdf(name, data)
    elif ext == ".docx":
        doc = _docx(name, data)
    else:
        raise DocError("%s: only PDF and Word (.docx) documents are converted" % name)
    if len(doc.text) > MAX_CHARS:
        doc.text = doc.text[:MAX_CHARS] + "\n\n(... cut at %d characters)\n" % MAX_CHARS
        doc.warnings.append("text cut at %d characters" % MAX_CHARS)
    return doc


# ------------------------------------------------------------------ PDF

def _pdf(name: str, data: bytes) -> Doc:
    try:
        from pypdf import PdfReader
    except ImportError as e:   # pragma: no cover - the delivered build bundles it
        raise DocError("PDF support is not installed (pypdf)") from e
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except Exception as e:   # noqa: BLE001
                raise DocError("%s is password protected" % name) from e
        pages = list(reader.pages)
    except DocError:
        raise
    except Exception as e:   # noqa: BLE001 - pypdf raises many kinds on a broken file
        raise DocError("%s is not a readable PDF: %s" % (name, e)) from e
    out = ["# %s" % name, ""]
    empty: List[int] = []
    for i, page in enumerate(pages, 1):
        try:
            text = page.extract_text() or ""
        except Exception:   # noqa: BLE001 - one bad page does not lose the others
            text = ""
        text = _tidy(text)
        if not text:
            empty.append(i)
            continue
        out += ["## Page %d" % i, "", text, ""]
    warnings: List[str] = []
    if empty:
        warnings.append("no text layer on page(s) %s (scanned?); not read, no OCR" % _ranges(empty))
    if len(empty) == len(pages):
        raise DocError("%s has no text layer (a scan?); OCR is not supported: provide a text PDF or .docx" % name)
    return Doc(name=name, text="\n".join(out).strip() + "\n", kind="pdf", pages=len(pages), warnings=warnings)


def _tidy(text: str) -> str:
    lines = [ln.rstrip() for ln in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    text = "\n".join(lines)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _ranges(nums: List[int]) -> str:
    out, start, prev = [], None, None
    for n in nums + [None]:
        if start is None:
            start = prev = n
        elif n is not None and n == prev + 1:
            prev = n
        else:
            out.append(str(start) if start == prev else "%d-%d" % (start, prev))
            start = prev = n
    return ", ".join(out)


# ------------------------------------------------------------------ DOCX

def _docx(name: str, data: bytes) -> Doc:
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        xml = z.read("word/document.xml")
    except (zipfile.BadZipFile, KeyError) as e:
        raise DocError("%s is not a readable .docx file" % name) from e
    styles = _styles(z)
    numbered = _numbered(z)
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as e:
        raise DocError("%s: broken document.xml: %s" % (name, e)) from e
    body = root.find(W + "body")
    if body is None:
        raise DocError("%s has no document body" % name)
    out: List[str] = ["# %s" % name, ""]
    warnings: List[str] = []
    pictures = 0
    for el in body:
        if el.tag == W + "p":
            line, pics = _para(el, styles, numbered)
            pictures += pics
            if line is not None:
                out.append(line)
        elif el.tag == W + "tbl":
            out += ["", _table(el), ""]
    if pictures:
        warnings.append("%d picture(s) or drawing(s) not read" % pictures)
    text = re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip() + "\n"
    if len(text.strip().splitlines()) <= 1:
        raise DocError("%s has no text" % name)
    return Doc(name=name, text=text, kind="docx", pages=0, warnings=warnings)


def _styles(z: zipfile.ZipFile) -> dict:
    """styleId -> heading level (Title = 1, Heading n = n), from word/styles.xml (localised style names too)."""
    try:
        root = ET.fromstring(z.read("word/styles.xml"))
    except (KeyError, ET.ParseError):
        return {}
    out = {}
    for st in root.iter(W + "style"):
        sid = st.get(W + "styleId") or ""
        nm = st.find(W + "name")
        label = (nm.get(W + "val") if nm is not None else "") or sid
        level = _heading_level(label) or _heading_level(sid)
        if level is None:
            ol = st.find("%spPr/%soutlineLvl" % (W, W))
            if ol is not None and (ol.get(W + "val") or "").isdigit():
                level = int(ol.get(W + "val")) + 1
        if level:
            out[sid] = level
    return out


def _heading_level(label: str) -> Optional[int]:
    s = (label or "").strip().lower()
    if s == "title":
        return 1
    m = re.match(r"^(?:heading|titre|überschrift|tiêu đề|tieude)\s*(\d)$", s)
    return min(int(m.group(1)), 6) if m else None


def _numbered(z: zipfile.ZipFile) -> bool:
    return "word/numbering.xml" in z.namelist()


def _para(p: ET.Element, styles: dict, numbered: bool) -> tuple:
    """-> (markdown line or None for nothing at all, pictures in it)."""
    ppr = p.find(W + "pPr")
    level = None
    is_list = False
    if ppr is not None:
        ps = ppr.find(W + "pStyle")
        if ps is not None:
            level = styles.get(ps.get(W + "val") or "") or _heading_level(ps.get(W + "val") or "")
        is_list = ppr.find(W + "numPr") is not None
    parts: List[str] = []
    pics = 0
    for node in p.iter():
        if node.tag == W + "t":
            parts.append(node.text or "")
        elif node.tag == W + "tab":
            parts.append("\t")
        elif node.tag in (W + "br", W + "cr"):
            parts.append("\n")
        elif node.tag in (W + "drawing", W + "pict"):
            pics += 1
    text = "".join(parts).strip()
    if not text:
        return ("" if pics == 0 else None), pics
    if level:
        return "\n%s %s\n" % ("#" * min(level + 1, 6), text.replace("\n", " ")), pics   # the file name is the # title
    if is_list:
        indent = 0
        ilvl = ppr.find("%snumPr/%silvl" % (W, W)) if ppr is not None else None
        if ilvl is not None and (ilvl.get(W + "val") or "").isdigit():
            indent = int(ilvl.get(W + "val"))
        return "%s- %s" % ("  " * indent, text.replace("\n", " ")), pics
    return text + "\n", pics


def _cell_text(tc: ET.Element) -> str:
    lines = []
    for p in tc.iter(W + "p"):
        t = "".join((n.text or "") if n.tag == W + "t" else (" " if n.tag == W + "tab" else "")
                    for n in p.iter() if n.tag in (W + "t", W + "tab")).strip()
        if t:
            lines.append(t)
    return "<br>".join(lines).replace("|", "\\|")


def _table(tbl: ET.Element) -> str:
    rows: List[List[str]] = []
    for tr in tbl.findall(W + "tr"):
        row: List[str] = []
        for tc in tr.findall(W + "tc"):
            span = 1
            tcpr = tc.find(W + "tcPr")
            if tcpr is not None:
                gs = tcpr.find(W + "gridSpan")
                if gs is not None and (gs.get(W + "val") or "").isdigit():
                    span = int(gs.get(W + "val"))
            row.append(_cell_text(tc))
            row += [""] * (span - 1)
        rows.append(row)
    if not rows:
        return ""
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    out = ["| " + " | ".join(rows[0]) + " |", "|" + "---|" * width]
    out += ["| " + " | ".join(r) + " |" for r in rows[1:]]
    return "\n".join(out)


# ------------------------------------------------------------------ command

def main(argv: List[str]) -> int:
    """dlc doc <file> [<out.md>]: print (or write) a PDF / Word document as markdown; exit 2 when unreadable."""
    import sys
    if not argv:
        print("usage: dlc doc <file.pdf|file.docx> [out.md]", file=sys.stderr)
        return 2
    try:
        doc = convert(argv[0])
    except DocError as e:
        print("unreadable: %s" % e, file=sys.stderr)
        return 2
    for w in doc.warnings:
        print("warning: %s" % w, file=sys.stderr)
    if len(argv) > 1:
        with open(argv[1], "w", encoding="utf-8", newline="\n") as fh:
            fh.write(doc.text)
    else:
        sys.stdout.reconfigure(encoding="utf-8")   # type: ignore[attr-defined]
        sys.stdout.write(doc.text)
    return 0


__all__ = ["Doc", "DocError", "KINDS", "convert", "convert_bytes", "readable", "md_name", "main"]
