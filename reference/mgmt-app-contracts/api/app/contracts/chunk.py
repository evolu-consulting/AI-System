import re

from app.ingest.chunk import chunk_markdown, split_tokens

# Docling rarely marks "Điều 8" as a heading; it arrives as a bold or plain line.
_LEAD = re.compile(r"^[\s#*_>]+")
_ARTICLE = re.compile(r"^(?:điều|article)\s+(\d+)\s*[.:\-–—]?\s*(.*)$", re.I)
_APPENDIX = re.compile(r"^(?:phụ lục|appendix)\s*([0-9]+|[IVX]+\b|[A-Z]\b)?\s*[.:\-–—]?\s*(.*)$", re.I)
_MAX_HEAD_LINE = 120   # a body sentence that merely mentions "Điều 5" is longer than a heading line


def _boundary(line: str) -> tuple[str, str] | None:
    s = _LEAD.sub("", line).rstrip(" *_")
    if not s or len(s) > _MAX_HEAD_LINE:
        return None
    m = _ARTICLE.match(s)
    if m and (not m.group(2) or not m.group(2)[0].islower()):
        return m.group(1), m.group(2).strip(" *_")
    m = _APPENDIX.match(s)
    if m and m.group(1):   # "PHỤ LỤC 01 …" starts a price appendix; "PHỤ LỤC HỢP ĐỒNG SỐ …" is a document title
        return f"PL{m.group(1)}", (m.group(2) or "Phụ lục").strip(" *_")
    return None


def chunk_contract(md: str) -> list[dict]:
    sections: list[tuple[str, str, list[str]]] = [("0", "Mở đầu", [])]
    found = False
    for line in md.splitlines():
        b = _boundary(line)
        if b:
            found = True
            sections.append((b[0], b[1], []))
        else:
            sections[-1][2].append(line)
    if not found:
        return [{"text": t, "clause_no": str(i), "heading": t.split("\n", 1)[0][:120]}
                for i, t in enumerate(chunk_markdown(md))]

    out: list[dict] = []
    for no, heading, body in sections:
        text = "\n".join(body).strip()
        if not text and no == "0":
            continue
        label = "Mở đầu" if no == "0" else (f"Điều {no}. {heading}" if not no.startswith("PL")
                                              else f"Phụ lục {no[2:]} {heading}".replace("  ", " ").strip())
        for piece in split_tokens(label if no != "0" else "", text or label):
            out.append({"text": piece, "clause_no": no, "heading": heading or label})
    return out
