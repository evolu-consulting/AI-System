// Luật thuần cho Delta kiểu OpenSpec (ADR-0032): phân tích + kiểm `## Delta (so với docs/current)` trong tasks.md.
// Không đọc đĩa: caller đưa `fileExists` để kiểm file docs/current.

export type DeltaKind = "ADDED" | "MODIFIED" | "REMOVED";
export interface DeltaReq {
  name: string;
  line: number;
  scenarios: number;
}
export interface DeltaBlock {
  kind: DeltaKind;
  file: string;
  line: number;
  reqs: DeltaReq[];
  hasReason: boolean;
}
export interface Issue {
  line: number;
  msg: string;
}
export interface ParsedDelta {
  found: boolean;
  /** dòng (1-based) của `## Delta …`. */
  headingLine: number;
  statusLine: number;
  state: "chưa gộp" | "đã gộp" | null;
  noChange: { reason: string; line: number } | null;
  blocks: DeltaBlock[];
  issues: Issue[];
}

export const DELTA_HEADING = "## Delta (so với docs/current)";
const HEADING_RE = /^##\s+Delta\s*\(so với docs\/current\)/;
const STATUS_RE = /^\s*(?:[-*]\s*)?(?:\*\*)?Trạng thái gộp:(?:\*\*)?\s*(.*?)\s*$/;
const BLOCK_RE = /^###\s+(\S+)\s*(.*?)\s*$/;
const REQ_RE = /^####\s+Yêu cầu:\s*(.*?)\s*$/;
const SCENARIO_RE = /^\s*[-*]\s*Kịch bản:\s*(\S.*)$/;
const REASON_RE = /^\s*(?:[-*]\s*)?Lý do:\s*(\S.*)$/;
const NOCHANGE_RE = /^\s*(?:[-*]\s*)?Không thay đổi hành vi\s*\(lý do:\s*(.*)\)\s*\.?\s*$/;
const DONE_RE = /^đã gộp \d{4}-\d{2}-\d{2}(?:\s.*)?$/;

/** Lấy các dòng thuộc mục Delta (bỏ qua khối ``` ), kèm số dòng 1-based. */
function deltaLines(text: string): { headingLine: number; lines: [number, string][] } | null {
  const all = text.split(/\r?\n/);
  const start = all.findIndex((l) => HEADING_RE.test(l));
  if (start < 0) return null;
  const lines: [number, string][] = [];
  let fence = false;
  for (let i = start + 1; i < all.length; i++) {
    const l = all[i] ?? "";
    if (l.trimStart().startsWith("```")) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    if (/^##\s/.test(l)) break;
    lines.push([i + 1, l]);
  }
  return { headingLine: start + 1, lines };
}

function empty(headingLine: number, found: boolean): ParsedDelta {
  return {
    found,
    headingLine,
    statusLine: 0,
    state: null,
    noChange: null,
    blocks: [],
    issues: [],
  };
}

interface Ctx {
  p: ParsedDelta;
  cur: DeltaBlock | null;
  req: DeltaReq | null;
}

function onStatus(p: ParsedDelta, n: number, v: string): void {
  p.statusLine = n;
  if (v === "chưa gộp") p.state = "chưa gộp";
  else if (DONE_RE.test(v)) p.state = "đã gộp";
  else
    p.issues.push({
      line: n,
      msg: `Trạng thái gộp không hợp lệ: "${v}" (chỉ "chưa gộp" hoặc "đã gộp YYYY-MM-DD")`,
    });
}

function onReq(c: Ctx, n: number, name: string): void {
  if (!c.cur)
    c.p.issues.push({ line: n, msg: "#### Yêu cầu nằm ngoài khối ### ADDED/MODIFIED/REMOVED" });
  else if (!name) c.p.issues.push({ line: n, msg: "#### Yêu cầu: thiếu tên" });
  else {
    c.req = { name, line: n, scenarios: 0 };
    c.cur.reqs.push(c.req);
  }
}

function onMeta(c: Ctx, n: number, l: string): boolean {
  const st = STATUS_RE.exec(l);
  if (st) {
    onStatus(c.p, n, st[1] ?? "");
    return true;
  }
  const nc = NOCHANGE_RE.exec(l);
  if (!nc) return false;
  const reason = (nc[1] ?? "").trim();
  if (reason) c.p.noChange = { reason, line: n };
  else c.p.issues.push({ line: n, msg: "Không thay đổi hành vi: thiếu lý do" });
  return true;
}

function onHeading(c: Ctx, n: number, l: string): boolean {
  const b = BLOCK_RE.exec(l);
  if (b) {
    c.req = null;
    c.cur = openBlock(c.p, n, b[1] ?? "", b[2] ?? "");
    return true;
  }
  const r = REQ_RE.exec(l);
  if (r) onReq(c, n, r[1] ?? "");
  else if (/^####\s/.test(l))
    c.p.issues.push({ line: n, msg: 'tiêu đề #### phải có dạng "#### Yêu cầu: <tên>"' });
  else return false;
  return true;
}

function onLine(c: Ctx, n: number, l: string): void {
  if (onMeta(c, n, l) || onHeading(c, n, l)) return;
  if (SCENARIO_RE.test(l)) {
    if (c.req) c.req.scenarios++;
    else c.p.issues.push({ line: n, msg: "Kịch bản nằm ngoài một #### Yêu cầu" });
  } else if (c.cur && REASON_RE.test(l)) c.cur.hasReason = true;
}
export function parseDelta(text: string): ParsedDelta {
  const sec = deltaLines(text);
  if (!sec) return empty(0, false);
  const c: Ctx = { p: empty(sec.headingLine, true), cur: null, req: null };
  for (const [n, l] of sec.lines) onLine(c, n, l);
  return c.p;
}

function openBlock(p: ParsedDelta, line: number, kind: string, rest: string): DeltaBlock | null {
  if (kind !== "ADDED" && kind !== "MODIFIED" && kind !== "REMOVED") {
    p.issues.push({
      line,
      msg: `khối ### "${kind}" không hợp lệ (dùng ADDED, MODIFIED hoặc REMOVED)`,
    });
    return null;
  }
  const file = rest.replace(/^`|`$/g, "").trim();
  const blk: DeltaBlock = { kind, file, line, reqs: [], hasReason: false };
  if (!file) p.issues.push({ line, msg: `### ${kind} thiếu tên file trong docs/current` });
  p.blocks.push(blk);
  return blk;
}

/** Kiểm Delta đã phân tích. `fileExists(rel)`: rel tính từ docs/current. */
export function validateDelta(p: ParsedDelta, fileExists: (rel: string) => boolean): Issue[] {
  if (!p.found) {
    return [
      {
        line: 1,
        msg: `thiếu mục "${DELTA_HEADING}" (ghi "Không thay đổi hành vi (lý do: …)" nếu lát không đổi hành vi)`,
      },
    ];
  }
  const out = [...p.issues];
  if (!p.state && !out.some((i) => i.msg.startsWith("Trạng thái gộp")))
    out.push({
      line: p.headingLine,
      msg: "thiếu dòng `Trạng thái gộp: chưa gộp | đã gộp YYYY-MM-DD`",
    });
  if (p.noChange && p.blocks.length)
    out.push({
      line: p.noChange.line,
      msg: "vừa có `Không thay đổi hành vi` vừa có khối ADDED/MODIFIED/REMOVED — chọn một",
    });
  if (!p.noChange && !p.blocks.length)
    out.push({
      line: p.headingLine,
      msg: "Delta rỗng: cần ít nhất một khối ### ADDED/MODIFIED/REMOVED hoặc dòng `Không thay đổi hành vi (lý do: …)`",
    });
  for (const b of p.blocks) out.push(...validateBlock(b, fileExists));
  return out.sort((a, b) => a.line - b.line);
}

function validateBlock(b: DeltaBlock, fileExists: (rel: string) => boolean): Issue[] {
  const out: Issue[] = [];
  if (b.file) {
    if (b.file.includes("..") || b.file.startsWith("/") || !b.file.endsWith(".md"))
      out.push({
        line: b.line,
        msg: `"${b.file}": cần đường dẫn .md tương đối trong docs/current`,
      });
    else if (b.kind !== "ADDED" && !fileExists(b.file))
      out.push({
        line: b.line,
        msg: `${b.kind} trỏ tới docs/current/${b.file} nhưng file không tồn tại (file mới thì dùng ADDED)`,
      });
  }
  if (b.kind === "REMOVED") {
    if (!b.hasReason && !b.reqs.length)
      out.push({ line: b.line, msg: `REMOVED ${b.file}: thiếu dòng "Lý do: …"` });
    return out;
  }
  if (!b.reqs.length)
    out.push({ line: b.line, msg: `${b.kind} ${b.file}: cần ít nhất một "#### Yêu cầu: <tên>"` });
  for (const r of b.reqs)
    if (r.scenarios < 1)
      out.push({
        line: r.line,
        msg: `Yêu cầu "${r.name}": cần ≥ 1 dòng "- Kịch bản: khi … thì …"`,
      });
  return out;
}

/** Đổi dòng trạng thái thành "đã gộp <ngày>"; trả null nếu không có dòng trạng thái. */
export function markMerged(
  text: string,
  p: ParsedDelta,
  date: string,
  wave?: string,
): string | null {
  if (!p.statusLine) return null;
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  lines[p.statusLine - 1] = `Trạng thái gộp: đã gộp ${date}${wave ? ` (đợt ${wave})` : ""}`;
  return lines.join(nl);
}
