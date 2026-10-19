// PK-FR-07 · PK-AC08 · PK-NFR-02: dựng zip/DOCX bằng tay cho test (không phụ thuộc thư viện DOCX của ADR-0024). Hỗ trợ entry
// STORED/DEFLATE, và khai báo `declaredSize` LỆCH thật (zip bomb khai báo). Không chứa `it(...)`.
import { deflateRawSync } from "node:zlib";

export type ZipEntry = {
  name: string;
  data: Uint8Array;
  /** 0 = stored · 8 = deflate (mặc định 8 khi data > 0). */
  method?: 0 | 8;
  /** Kích thước giải nén GHI TRONG header (mặc định = thật). */
  declaredSize?: number;
};
const enc = new TextEncoder();
export const u8 = (s: string): Uint8Array => enc.encode(s);
const le16 = (n: number) => [n & 255, (n >> 8) & 255];
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];

export function buildZip(entries: ZipEntry[]): Uint8Array {
  const parts: number[][] = [];
  const central: number[][] = [];
  let off = 0;
  const push = (b: number[] | Uint8Array) => {
    const a = Array.isArray(b) ? b : Array.from(b);
    parts.push(a);
    off += a.length;
  };
  for (const e of entries) {
    const name = Array.from(enc.encode(e.name));
    const method = e.method ?? (e.data.length > 0 ? 8 : 0);
    const comp = method === 8 ? deflateRawSync(e.data) : e.data;
    const crc = Bun.hash.crc32(e.data) >>> 0;
    const usize = e.declaredSize ?? e.data.length;
    const local = [
      0x50,
      0x4b,
      3,
      4,
      ...le16(20),
      ...le16(0),
      ...le16(method),
      ...le16(0),
      ...le16(0x21),
      ...le32(crc),
      ...le32(comp.length),
      ...le32(usize),
      ...le16(name.length),
      ...le16(0),
      ...name,
    ];
    central.push([
      0x50,
      0x4b,
      1,
      2,
      ...le16(20),
      ...le16(20),
      ...le16(0),
      ...le16(method),
      ...le16(0),
      ...le16(0x21),
      ...le32(crc),
      ...le32(comp.length),
      ...le32(usize),
      ...le16(name.length),
      ...le16(0),
      ...le16(0),
      ...le16(0),
      ...le16(0),
      ...le32(0),
      ...le32(off),
      ...name,
    ]);
    push(local);
    push(comp);
  }
  const cdStart = off;
  for (const c of central) push(c);
  const cdSize = off - cdStart;
  push([
    0x50,
    0x4b,
    5,
    6,
    ...le16(0),
    ...le16(0),
    ...le16(entries.length),
    ...le16(entries.length),
    ...le32(cdSize),
    ...le32(cdStart),
    ...le16(0),
  ]);
  const out = new Uint8Array(off);
  let p = 0;
  for (const a of parts) {
    out.set(a, p);
    p += a.length;
  }
  return out;
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const para = (text: string, style?: string, numId?: number) =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${numId ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>` : ""}</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const cell = (t: string) => `<w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
const table = (rows: string[][]) =>
  `<w:tbl>${rows.map((r) => `<w:tr>${r.map(cell).join("")}</w:tr>`).join("")}</w:tbl>`;

/** DOCX tối thiểu hợp lệ: tiêu đề (Heading1), đoạn, danh sách, bảng 2×3. */
export function minimalDocx(extra: ZipEntry[] = []): Uint8Array {
  const body = [
    para("Điều 1. Hàng hoá", "Heading1"),
    para("Bên A mua hàng của Bên B."),
    para("Giao hàng đúng hạn", undefined, 1),
    para("Thanh toán đủ", undefined, 1),
    table([
      ["Tên hàng", "Số lượng"],
      ["Thùng carton", "1000"],
      ["Màng bọc", "50"],
    ]),
  ].join("");
  return buildZip([
    {
      name: "[Content_Types].xml",
      data: u8(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
    },
    {
      name: "_rels/.rels",
      data: u8(
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
    },
    {
      name: "word/document.xml",
      data: u8(
        `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>`,
      ),
    },
    {
      name: "word/numbering.xml",
      data: u8(
        `<?xml version="1.0"?><w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
      ),
    },
    {
      name: "word/styles.xml",
      data: u8(
        `<?xml version="1.0"?><w:styles ${W}><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>`,
      ),
    },
    ...extra,
  ]);
}
