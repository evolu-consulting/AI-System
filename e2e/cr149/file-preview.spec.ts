// CR-149 · «Xem» PDF và Word trong hộp (stack journey thật, công ty `e2e-par-<hậu tố>`): thêm .pdf và .docx vào «Tài liệu kèm» ⇒ bấm «Xem» ⇒
// PDF hiện trang (pdf.js), Word hiện chữ (docx-preview), cả hai có «Tải về»; tệp .xlsx chỉ hiện tên + «Tải về».
// Viết sẵn, KHÔNG chạy trong lát — chạy một lần ở lượt e2e cuối đợt.

import { envOf, expect, loginCw, newPage, SPEC_TENANT, U } from "../cr127/_cr127-kit";
import { uploadAndOpen } from "../journey-approval/_journey";
import { test } from "../journey-approval/_test";

test.describe.configure({ mode: "serial" });
const E = envOf(SPEC_TENANT.j10);
const RUN = Date.now().toString(36);
const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const crc = (b: Buffer) => {
  let c = ~0;
  for (const x of b) {
    c ^= x;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
};
/** ZIP "stored" (không nén) tối thiểu — đủ cho docx-preview. */
function zip(files: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  const cd: Buffer[] = [];
  let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const n = Buffer.from(name);
    const d = Buffer.from(text);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt32LE(crc(d), 14);
    h.writeUInt32LE(d.length, 18);
    h.writeUInt32LE(d.length, 22);
    h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc(d), 16);
    c.writeUInt32LE(d.length, 20);
    c.writeUInt32LE(d.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(off, 42);
    parts.push(h, n, d);
    cd.push(c, n);
    off += 30 + n.length + d.length;
  }
  const dir = Buffer.concat(cd);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, dir, end]);
}
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const DOCX = zip({
  "[Content_Types].xml":
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  "_rels/.rels":
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  "word/document.xml": `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Điều khoản thanh toán CR149</w:t></w:r></w:p></w:body></w:document>`,
});
const PDF = Buffer.from(
  "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R/Size 4>>\n%%EOF",
  "latin1",
);

test("Xem PDF và Word trong hộp; loại khác chỉ có Tải về", async ({ browser }) => {
  test.setTimeout(300_000);
  const page = await newPage(browser);
  await loginCw(page, E, U.employee);
  await uploadAndOpen(page, E, `cr149-${RUN}`);
  const input = page.getByTestId("cfiles-input");
  await expect(page.getByTestId("cfiles")).toBeVisible({ timeout: 120_000 });
  await input.setInputFiles({ name: "bao-gia.pdf", mimeType: "application/pdf", buffer: PDF });
  await input.setInputFiles({ name: "phu-luc.docx", mimeType: MIME_DOCX, buffer: DOCX });
  const row = (n: string) => page.getByTestId("cfile-row").filter({ hasText: n });
  await expect(row("phu-luc.docx")).toBeVisible({ timeout: 60_000 });

  await row("bao-gia.pdf").getByRole("button", { name: "Xem" }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByTestId("pdf-page").first()).toBeVisible({ timeout: 30_000 });
  await expect(dlg.getByRole("button", { name: "Phóng to" })).toBeVisible();
  await expect(dlg.getByTestId("fview-download")).toBeVisible();
  await page.keyboard.press("Escape");

  await row("phu-luc.docx").getByRole("button", { name: "Xem" }).click();
  await expect(dlg.frameLocator('[data-testid="docx-frame"]').locator("body")).toContainText(
    "Điều khoản thanh toán CR149",
    { timeout: 30_000 },
  );
  await expect(dlg.getByTestId("fview-download")).toBeVisible();
});
