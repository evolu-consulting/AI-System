// N4-FR-02 · ADR-0021 §1 ("dựng từ pipeline mgmt-app"): chia đoạn — port `mgmt-app/api/app/ingest/chunk.py` (theo tiêu đề,
// cắt có chồng lấn, gộp đoạn ngắn liền nhau) và `contracts/chunk.py` (theo "Điều N" / "Phụ lục N"). Khác bản gốc: ngân sách
// theo KÝ TỰ thay token tiktoken (không thêm thư viện; ~800 token cl100k ≈ 1.800 ký tự tiếng Việt có dấu). Thuần, tất định.
import { codeAliases } from "./text.rules";

export const MAX_CHARS = 1800;
export const OVERLAP_CHARS = 200;
export const HEAD_MAX_CHARS = 300;

export type Chunk = { heading: string; clauseNo: string | null; body: string; context: string };
export type DocKind = "markdown" | "contract";

const HEADING = /^(#{1,6})\s+(.*)$/;

/** Một mục → các mảnh ≤ MAX_CHARS (tiêu đề lặp lại ở mỗi mảnh), chồng lấn OVERLAP_CHARS; cắt ở khoảng trắng gần nhất. */
export function splitChars(heading: string, text: string): string[] {
  const head = heading.slice(0, HEAD_MAX_CHARS);
  const bodyMax = MAX_CHARS - (head ? head.length + 1 : 0);
  const out: string[] = [];
  let start = 0;
  for (;;) {
    let end = Math.min(text.length, start + bodyMax);
    if (end < text.length) {
      const sp = text.lastIndexOf(" ", end);
      if (sp > start + bodyMax / 2) end = sp;
    }
    const piece = text.slice(start, end);
    out.push(head ? `${head}\n${piece}` : piece);
    if (end >= text.length) break;
    start = Math.max(start + 1, end - OVERLAP_CHARS);
  }
  return out;
}

/** Gộp mảnh liền nhau khi còn vừa (giữ tiêu đề và thứ tự đọc) — như `_pack` của bản gốc. */
function pack(pieces: string[]): string[] {
  const out: string[] = [];
  for (const p of pieces) {
    const last = out[out.length - 1];
    if (last !== undefined && last.length + p.length + 1 <= MAX_CHARS)
      out[out.length - 1] = `${last}\n${p}`;
    else out.push(p);
  }
  return out;
}

/** Markdown theo tiêu đề: đường dẫn tiêu đề "A > B" làm heading mỗi mục. */
export function chunkMarkdown(md: string): string[] {
  const sections: [string, string][] = [];
  const path: string[] = [];
  let buf: string[] = [];
  const flush = (): void => {
    const text = buf.join("\n").trim();
    if (text) sections.push([path.join(" > "), text]);
    buf = [];
  };
  for (const line of md.split(/\r?\n/)) {
    const m = HEADING.exec(line);
    if (m) {
      flush();
      const level = (m[1] as string).length;
      path.splice(level - 1, path.length, (m[2] as string).trim());
    } else buf.push(line);
  }
  flush();
  return pack(sections.flatMap(([h, t]) => splitChars(h, t)));
}

const LEAD = /^[\s#*_>]+/;
const ARTICLE = /^(?:điều|article)\s+(\d+)\s*[.:\-–—]?\s*(.*)$/iu;
const APPENDIX = /^(?:phụ lục|appendix)\s*([0-9]+|[IVX]+\b|[A-Z]\b)?\s*[.:\-–—]?\s*(.*)$/iu;
const MAX_HEAD_LINE = 120;

/** Dòng mở một điều khoản: ["6", "Phạt vi phạm"] hoặc ["PL1", "..."]; null nếu không. */
export function boundary(line: string): [string, string] | null {
  const s = line.replace(LEAD, "").replace(/[\s*_]+$/u, "");
  if (!s || s.length > MAX_HEAD_LINE) return null;
  const a = ARTICLE.exec(s);
  const rest = a?.[2] ?? "";
  if (a && (!rest || rest[0] === rest[0]?.toUpperCase()))
    return [a[1] as string, rest.replace(/^[\s*_]+|[\s*_]+$/gu, "")];
  const p = APPENDIX.exec(s);
  if (p?.[1]) return [`PL${p[1]}`, (p[2] || "Phụ lục").replace(/^[\s*_]+|[\s*_]+$/gu, "")];
  return null;
}

function label(no: string, heading: string): string {
  if (no === "0") return "Mở đầu";
  if (no.startsWith("PL")) return `Phụ lục ${no.slice(2)} ${heading}`.replace(/\s+/g, " ").trim();
  return `Điều ${no}. ${heading}`;
}

/** Hợp đồng: một đoạn mỗi điều khoản (lớn thì cắt); không có "Điều N" ⇒ chia như Markdown. */
export function chunkContract(md: string): Omit<Chunk, "context">[] {
  const sections: [string, string, string[]][] = [["0", "Mở đầu", []]];
  for (const line of md.split(/\r?\n/)) {
    const b = boundary(line);
    if (b) sections.push([b[0], b[1], []]);
    else sections[sections.length - 1]?.[2].push(line);
  }
  if (sections.length === 1)
    return chunkMarkdown(md).map((t, i) => ({
      heading: (t.split("\n", 1)[0] ?? "").slice(0, 120),
      clauseNo: String(i),
      body: t,
    }));
  return sections.flatMap(([no, heading, body]) => sectionChunks(no, heading, body));
}

function sectionChunks(no: string, heading: string, body: string[]): Omit<Chunk, "context">[] {
  const text = body.join("\n").trim();
  if (!text && no === "0") return [];
  const lab = label(no, heading);
  return splitChars(no === "0" ? "" : lab, text || lab).map((piece) => ({
    heading: (heading || lab).slice(0, 400),
    clauseNo: no,
    body: piece,
  }));
}

/**
 * Ngữ cảnh tài liệu gắn vào MỌI đoạn (trọng số C trong `tsv`): tiêu đề + dòng "Số:" + dòng các bên (hợp đồng) + phần mã viết
 * tắt. Đoạn "Điều 5. Bảo hành" của hai hợp đồng giống hệt chữ ⇒ chỉ ngữ cảnh phân biệt được hợp đồng nào.
 */
export function docContext(title: string, md: string): string {
  const lines = md.split(/\r?\n/).slice(0, 40);
  const pick = lines
    .map((l) => l.replace(/[*_#>]/g, "").trim())
    .filter((l) => /^(số|kèm theo)(?=[\s:.])/iu.test(l) || /^bên (mua|bán)(?=[\s:(])/iu.test(l));
  const base = [title, ...pick].join(" · ");
  return [base, ...codeAliases(base)].join(" · ").slice(0, 600);
}

/** Văn bản → đoạn có ngữ cảnh (chưa có id/ord). */
export function chunkDocument(title: string, md: string, kind: DocKind): Chunk[] {
  const context = docContext(title, md);
  const raw =
    kind === "contract"
      ? chunkContract(md)
      : chunkMarkdown(md).map((t) => ({
          heading: (t.split("\n", 1)[0] ?? "").slice(0, 400),
          clauseNo: null,
          body: t,
        }));
  return raw.filter((c) => c.body.trim() !== "").map((c) => ({ ...c, context }));
}
