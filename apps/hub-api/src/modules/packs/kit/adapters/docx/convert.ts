// PK-FR-07 · ADR-0024: DOCX bytes → Markdown, đồng bộ, KHÔNG ném (chạy trong worker `docx.worker.ts`). Thứ tự: chữ ký zip →
// central directory → `checkZipEntries` (số phần, macro, tổng khai báo, tỉ lệ nén) → chỉ giải nén document/styles/numbering
// (đếm byte thật) → saxes → bộ ghi Markdown. Không đọc quan hệ ngoài (ảnh/link) ⇒ không tải gì.
import {
  checkZipEntries,
  DOCX_MAX_PARTS,
  DOCX_MAX_XML,
  type DocxResult,
  emptyNumbering,
  partsNeeded,
  renderMarkdown,
} from "../../domain/docx.rules";
import { readDocument, readNumbering, readStyles } from "./ooxml-reader";
import {
  extractEntry,
  looksLikeZip,
  readCentralDirectory,
  type ZipEntryInfo,
  ZipError,
} from "./zip-reader";

export const UNREADABLE: DocxResult = { ok: false, code: "DOCX_UNREADABLE" };
const utf8 = new TextDecoder("utf-8");

function readXml(bytes: Uint8Array, e: ZipEntryInfo | undefined): string | null {
  if (!e) return null;
  if (e.originalSize > DOCX_MAX_XML) throw new ZipError("xml too large");
  return utf8.decode(extractEntry(bytes, e));
}

function convertUnsafe(bytes: Uint8Array): DocxResult {
  if (!looksLikeZip(bytes)) return UNREADABLE;
  const entries = readCentralDirectory(bytes, DOCX_MAX_PARTS + 1);
  if (checkZipEntries(entries) !== "ok") return UNREADABLE;
  const byName = new Map(entries.map((e) => [e.name, e]));
  const docXml = readXml(bytes, byName.get("word/document.xml"));
  if (docXml === null) return UNREADABLE;
  const { blocks, warnings } = readDocument(docXml);
  const need = partsNeeded(blocks);
  const stylesXml = need.styles ? readXml(bytes, byName.get("word/styles.xml")) : null;
  const numXml = need.numbering ? readXml(bytes, byName.get("word/numbering.xml")) : null;
  const styles = stylesXml ? readStyles(stylesXml) : new Map();
  const numbering = numXml ? readNumbering(numXml) : emptyNumbering();
  const out = renderMarkdown(blocks, styles, numbering, warnings);
  return { ok: true, markdown: out.markdown, warnings: out.warnings };
}

/** Mọi lỗi (zip hỏng, XML hỏng, entity lạ, vượt giới hạn) ⇒ `DOCX_UNREADABLE`. */
export function convertDocx(bytes: Uint8Array): DocxResult {
  try {
    return convertUnsafe(bytes);
  } catch {
    return UNREADABLE;
  }
}
