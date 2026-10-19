// PK-FR-07 · PK-NFR-02 · plan §7 · ADR-0024: luật thuần DOCX → Markdown — giới hạn chống zip bomb, port `DocxConverter`,
// ánh xạ khối OOXML (đoạn/tiêu đề/danh sách/bảng) → Markdown GFM. Không import gì (lớp 1). QC test ở
// `tests/acceptance/N1/rules/docx.rules.test.ts`.

const MiB = 1024 * 1024;
/** Số phần zip tối đa (central directory). */
export const DOCX_MAX_PARTS = 2000;
/** Tổng kích thước giải nén tối đa (khai báo, và đếm thật khi giải nén). */
export const DOCX_MAX_UNZIP = 100 * MiB;
/** Độ dài Markdown ra tối đa (ký tự) — vượt ⇒ cắt + cảnh báo `truncated`. */
export const DOCX_MAX_MD = 5_000_000;
/** Kích thước một phần XML được đọc (document/styles/numbering) tối đa. */
export const DOCX_MAX_XML = 50 * MiB;
/** Độ sâu lồng phần tử XML tối đa. */
export const DOCX_MAX_DEPTH = 256;
/** Tỉ lệ nén tối đa (giải nén / nén) cho phần ≥ DOCX_RATIO_MIN_BYTES — deflate tối đa ~1032:1, XML thật ≲ 100:1. */
export const DOCX_MAX_RATIO = 500;
export const DOCX_RATIO_MIN_BYTES = 1 * MiB;
/** Số cảnh báo tối đa trả về. */
export const DOCX_MAX_WARNINGS = 50;

export type DocxErrorCode = "DOCX_UNREADABLE" | "DOCX_BUSY";
export type DocxResult =
  | { ok: true; markdown: string; warnings: string[] }
  | { ok: false; code: DocxErrorCode };
/** Port (ADR-0023 §2): không ném — mọi lỗi thành `{ok:false}`. */
export interface DocxConverter {
  toMarkdown(bytes: Uint8Array): Promise<DocxResult>;
}

export type ZipEntryCheck = "ok" | "TOO_MANY_PARTS" | "TOO_LARGE" | "MACRO";
/** `size` = kích thước nén (tuỳ chọn) — có thì xét tỉ lệ nén. */
export type ZipEntryMeta = { name: string; originalSize: number; size?: number };

/** Xét central directory TRƯỚC khi giải nén: số phần → macro → tổng khai báo → tỉ lệ nén. */
export function checkZipEntries(entries: readonly ZipEntryMeta[]): ZipEntryCheck {
  if (entries.length > DOCX_MAX_PARTS) return "TOO_MANY_PARTS";
  let total = 0;
  let ratio = false;
  for (const e of entries) {
    if (/(^|\/)vbaProject\.bin$/i.test(e.name)) return "MACRO";
    total += e.originalSize;
    if (e.size !== undefined && e.originalSize >= DOCX_RATIO_MIN_BYTES)
      ratio ||= e.originalSize > Math.max(e.size, 1) * DOCX_MAX_RATIO;
  }
  return total > DOCX_MAX_UNZIP || ratio ? "TOO_LARGE" : "ok";
}

// ---- Mô hình khối đọc từ document.xml (adapter dựng, luật này viết ra Markdown) ----
export type DocxRun = { text: string; bold: boolean };
export type DocxPara = {
  kind: "p";
  runs: DocxRun[];
  styleId?: string;
  outline?: number;
  numId?: string;
  ilvl: number;
};
export type DocxTable = { kind: "table"; rows: string[][] };
export type DocxBlock = DocxPara | DocxTable;
export type DocxStyle = { name?: string; basedOn?: string; outline?: number };
/** numId → abstractNumId; abstractNumId → (ilvl → numFmt). */
export type DocxNumbering = {
  nums: Map<string, string>;
  formats: Map<string, Map<number, string>>;
};
export const emptyNumbering = (): DocxNumbering => ({ nums: new Map(), formats: new Map() });

const levelFromOutline = (o: number): number => (o >= 0 && o <= 8 ? Math.min(o + 1, 6) : 0);
function levelFromName(s: string | undefined): number {
  if (!s) return 0;
  if (/^title$/i.test(s)) return 1;
  const m = /^heading\s*([1-9])$/i.exec(s);
  return m ? Math.min(Number(m[1]), 6) : 0;
}

/** Cấp tiêu đề 1…6 (0 = không phải tiêu đề): outlineLvl đoạn → style (outlineLvl/tên, theo basedOn ≤ 10 bước) → styleId. */
export function headingLevel(p: DocxPara, styles: ReadonlyMap<string, DocxStyle>): number {
  if (p.outline !== undefined) return levelFromOutline(p.outline);
  let id = p.styleId;
  for (let i = 0; id && i < 10; i++) {
    const st = styles.get(id);
    if (!st) return levelFromName(id);
    if (st.outline !== undefined) return levelFromOutline(st.outline);
    const byName = levelFromName(st.name) || levelFromName(id);
    if (byName) return byName;
    id = st.basedOn;
  }
  return 0;
}

/** Dấu danh sách: `- ` (bullet / không rõ), `1. ` (đánh số); null = không phải mục danh sách. */
export function listMarker(p: DocxPara, numbering: DocxNumbering): string | null {
  if (!p.numId || p.numId === "0") return null;
  const abs = numbering.nums.get(p.numId);
  const fmt = abs === undefined ? undefined : numbering.formats.get(abs)?.get(p.ilvl);
  const ordered = fmt !== undefined && fmt !== "bullet" && fmt !== "none";
  return `${"  ".repeat(Math.min(Math.max(p.ilvl, 0), 8))}${ordered ? "1." : "-"} `;
}

const plain = (runs: readonly DocxRun[]): string =>
  runs
    .map((r) => r.text)
    .join("")
    .replace(/\s+/g, " ")
    .trim();

/** Chữ trong đoạn: gộp run cùng đậm; đậm ⇒ `**…**` (khoảng trắng đẩy ra ngoài dấu). */
export function inlineText(runs: readonly DocxRun[]): string {
  let out = "";
  for (const r of runs) {
    if (!r.bold || !r.text.trim()) {
      out += r.text;
      continue;
    }
    for (const [i, line] of r.text.split("\n").entries()) {
      if (i > 0) out += "\n";
      const m = /^(\s*)(.*?)(\s*)$/s.exec(line) as RegExpExecArray;
      out += m[2] ? `${m[1]}**${m[2]}**${m[3]}` : line;
    }
  }
  return out
    .replace(/\*\*\*\*/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

const cell = (s: string): string => s.replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");

/** Bảng → GFM: hàng đầu là tiêu đề, số cột = hàng dài nhất. */
export function tableMarkdown(rows: readonly string[][]): string {
  const cols = rows.reduce((n, r) => Math.max(n, r.length), 0);
  if (!cols) return "";
  const line = (r: readonly string[]) =>
    `| ${Array.from({ length: cols }, (_, i) => cell(r[i] ?? "")).join(" | ")} |`;
  const [head, ...rest] = rows as string[][];
  return [line(head ?? []), `| ${Array(cols).fill("---").join(" | ")} |`, ...rest.map(line)].join(
    "\n",
  );
}

type Piece = { text: string; list: boolean };
function blockPiece(
  b: DocxBlock,
  styles: ReadonlyMap<string, DocxStyle>,
  numbering: DocxNumbering,
): Piece | null {
  if (b.kind === "table") {
    const t = tableMarkdown(b.rows);
    return t ? { text: t, list: false } : null;
  }
  const lvl = headingLevel(b, styles);
  if (lvl) {
    const t = plain(b.runs);
    return t ? { text: `${"#".repeat(lvl)} ${t}`, list: false } : null;
  }
  const text = inlineText(b.runs);
  if (!text) return null;
  const marker = listMarker(b, numbering);
  return marker ? { text: marker + text.replace(/\n/g, " "), list: true } : { text, list: false };
}

/** Thêm cảnh báo (không trùng, ≤ DOCX_MAX_WARNINGS). */
export function addWarning(warnings: string[], w: string): void {
  if (warnings.length < DOCX_MAX_WARNINGS && !warnings.includes(w)) warnings.push(w);
}

/** Khối → Markdown (≤ DOCX_MAX_MD ký tự; vượt ⇒ cắt ở ranh giới khối + cảnh báo `truncated`). */
export function renderMarkdown(
  blocks: readonly DocxBlock[],
  styles: ReadonlyMap<string, DocxStyle>,
  numbering: DocxNumbering,
  warnings: string[] = [],
): { markdown: string; warnings: string[] } {
  const parts: string[] = [];
  let len = 0;
  let prevList = false;
  for (const b of blocks) {
    const p = blockPiece(b, styles, numbering);
    if (!p) continue;
    const sep = parts.length === 0 ? "" : p.list && prevList ? "\n" : "\n\n";
    if (len + sep.length + p.text.length + 1 > DOCX_MAX_MD) {
      addWarning(warnings, "truncated");
      break;
    }
    parts.push(sep, p.text);
    len += sep.length + p.text.length;
    prevList = p.list;
  }
  return { markdown: parts.length ? `${parts.join("")}\n` : "", warnings };
}

/** Cần đọc styles.xml / numbering.xml không (bỏ qua khi document không tham chiếu — nhanh hơn). */
export function partsNeeded(blocks: readonly DocxBlock[]): { styles: boolean; numbering: boolean } {
  let styles = false;
  let numbering = false;
  for (const b of blocks) {
    if (b.kind !== "p") continue;
    styles ||= b.styleId !== undefined;
    numbering ||= b.numId !== undefined && b.numId !== "0";
    if (styles && numbering) break;
  }
  return { styles, numbering };
}
