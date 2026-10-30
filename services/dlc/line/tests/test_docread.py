"""line.docread: PDF and Word documents as markdown (ingest, `dlc doc`, the agents' read_document tool)."""

import io
import json
import os
import shutil
import tempfile
import unittest
import zipfile

from line import agent_mcp, docread
from line.docread import DocError

W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'


def make_docx(body_xml: str, styles_xml: str = "") -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", '<w:document %s><w:body>%s</w:body></w:document>' % (W_NS, body_xml))
        if styles_xml:
            z.writestr("word/styles.xml", '<w:styles %s>%s</w:styles>' % (W_NS, styles_xml))
    return buf.getvalue()


def para(text: str, style: str = "", num: bool = False) -> str:
    ppr = ""
    if style or num:
        ppr = "<w:pPr>%s%s</w:pPr>" % ('<w:pStyle w:val="%s"/>' % style if style else "",
                                       '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' if num else "")
    return "<w:p>%s<w:r><w:t>%s</w:t></w:r></w:p>" % (ppr, text)


def make_pdf(pages) -> bytes:
    """A minimal text PDF (Helvetica), one text line per page; empty string = a page with no text layer."""
    objs = []
    kids = []
    n_pages = len(pages)
    font_id = 3 + 2 * n_pages
    for i, text in enumerate(pages):
        page_id, content_id = 3 + 2 * i, 4 + 2 * i
        kids.append("%d 0 R" % page_id)
        stream = ("BT /F1 12 Tf 72 720 Td (%s) Tj ET" % text) if text else ""
        objs.append((page_id, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents %d 0 R "
                              "/Resources << /Font << /F1 %d 0 R >> >> >>" % (content_id, font_id)))
        objs.append((content_id, "<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream)))
    objs = [(1, "<< /Type /Catalog /Pages 2 0 R >>"),
            (2, "<< /Type /Pages /Kids [%s] /Count %d >>" % (" ".join(kids), n_pages))] + objs
    objs.append((font_id, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"))
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = {}
    for oid, body in sorted(objs):
        offsets[oid] = out.tell()
        out.write(("%d 0 obj\n%s\nendobj\n" % (oid, body)).encode("latin-1"))
    xref = out.tell()
    count = max(offsets) + 1
    out.write(("xref\n0 %d\n0000000000 65535 f \n" % count).encode())
    for oid in range(1, count):
        out.write(("%010d 00000 n \n" % offsets[oid]).encode())
    out.write(("trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (count, xref)).encode())
    return out.getvalue()


class DocxTest(unittest.TestCase):
    def test_headings_lists_tables(self):
        styles = ('<w:style w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>'
                  '<w:style w:styleId="TieuDe2"><w:name w:val="Custom"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>')
        table = ('<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Loại</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Số trường</w:t>'
                 '</w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Mua bán</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r>'
                 '<w:t>5</w:t></w:r></w:p></w:tc></w:tr></w:tbl>')
        data = make_docx(para("Hợp đồng", "Heading1") + para("Phụ lục", "TieuDe2") + para("Điều 1: giá trị") +
                         para("mục một", num=True) + table, styles)
        doc = docread.convert_bytes("hop-dong.docx", data)
        self.assertEqual(doc.kind, "docx")
        self.assertIn("# hop-dong.docx", doc.text)
        self.assertIn("## Hợp đồng", doc.text)
        self.assertIn("### Phụ lục", doc.text)
        self.assertIn("- mục một", doc.text)
        self.assertIn("| Loại | Số trường |", doc.text)
        self.assertIn("| Mua bán | 5 |", doc.text)

    def test_broken_and_old_word(self):
        with self.assertRaises(DocError):
            docread.convert_bytes("x.docx", b"not a zip")
        with self.assertRaises(DocError) as cm:
            docread.convert_bytes("old.doc", b"\xd0\xcf\x11\xe0")
        self.assertIn(".docx", str(cm.exception))
        with self.assertRaises(DocError):
            docread.convert_bytes("x.xlsx", b"")


class PdfTest(unittest.TestCase):
    def test_pages_and_scan_warning(self):
        doc = docread.convert_bytes("rules.pdf", make_pdf(["Field Y must have 5 digits", "", "Payment in 30 days"]))
        self.assertEqual(doc.pages, 3)
        self.assertIn("## Page 1", doc.text)
        self.assertIn("Field Y must have 5 digits", doc.text)
        self.assertIn("## Page 3", doc.text)
        self.assertNotIn("## Page 2", doc.text)
        self.assertTrue(any("page(s) 2" in w for w in doc.warnings))

    def test_scan_only_is_refused(self):
        with self.assertRaises(DocError) as cm:
            docread.convert_bytes("scan.pdf", make_pdf(["", ""]))
        self.assertIn("OCR", str(cm.exception))

    def test_broken_pdf(self):
        with self.assertRaises(DocError):
            docread.convert_bytes("x.pdf", b"%PDF-1.4 garbage")


class IngestAndToolTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_pack_with_documents(self):
        from line.understand.ingest import ingest
        with open(os.path.join(self.tmp, "spec.md"), "w", encoding="utf-8") as fh:
            fh.write("# Change\n\n## F1 Export\n- exports\n")
        with open(os.path.join(self.tmp, "legal.pdf"), "wb") as fh:
            fh.write(make_pdf(["Contract field Y has 5 digits"]))
        with open(os.path.join(self.tmp, "types.docx"), "wb") as fh:
            fh.write(make_docx(para("Sale contract")))
        with open(os.path.join(self.tmp, "pack.json"), "w", encoding="utf-8") as fh:
            json.dump({"id": "p", "required": ["spec.md"]}, fh)
        pv = ingest(self.tmp, None)
        paths = {s.path for s in pv.spans}
        self.assertEqual(paths, {"spec.md", "legal.pdf", "types.docx"})
        self.assertTrue(any("5 digits" in s.text for s in pv.spans if s.path == "legal.pdf"))

    def test_read_document_tool(self):
        p = os.path.join(self.tmp, "a.docx")
        with open(p, "wb") as fh:
            fh.write(make_docx(para("x" * 5000)))
        self.assertIn("read_document", agent_mcp.allowed())
        out = agent_mcp.read_document({"path": p, "max_chars": 2000})
        self.assertFalse(out.get("error"))
        self.assertIn("more: call again with offset", out["text"])
        bad = agent_mcp.read_document({"path": os.path.join(self.tmp, "none.pdf")})
        self.assertTrue(bad["error"])


if __name__ == "__main__":
    unittest.main()
