// CR-114 · hub-agent-handoff · luật thuần của kho artifact + bàn giao bằng tham chiếu. Không I/O.
import { createHash } from "node:crypto";

/** Dưới ngưỡng này dán thẳng nội dung rẻ hơn tham chiếu (phong bì + một lời gọi `artifact.get`). */
export const INLINE_MAX_TOKENS = 300;
/** Chỉ nhúng vector artifact từ ngưỡng này (nhỏ hơn: FTS đủ, không tốn lời gọi embedding). */
export const EMBED_MIN_TOKENS = 500;
/** TTL mặc định; ghi lại cùng nội dung ⇒ gia hạn. */
export const DEFAULT_TTL_DAYS = 30;
/** Một lần `artifact.get` trả tối đa chừng này ký tự (agent hỏi tiếp bằng `range`). */
export const GET_MAX_CHARS = 16_000;
export const SHORT_LEN = 8;

/** sha256 hex (64) của nội dung — khoá đầy đủ, chỉ dùng bên trong. */
export const artifactKey = (body: string): string =>
  createHash("sha256").update(body, "utf8").digest("hex");

/** `art:` + 8 ký tự đầu — dạng lộ ra prompt/MCP. */
export const shortKey = (key: string): string => `art:${key.slice(0, SHORT_LEN)}`;

/**
 * Khoá do agent đưa (`art:3f9c21e8`, `3f9c21e8…`, hoặc đủ 64) → tiền tố hex chữ thường; sai dạng / ngắn hơn 8 ⇒ null
 * (không cho dò bằng tiền tố ngắn).
 */
export function parseKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const k = raw.trim().toLowerCase().replace(/^art:/, "");
  return /^[0-9a-f]{8,64}$/.test(k) ? k : null;
}

/**
 * Ước tính token không cần tokenizer: ~4 ký tự/token cho chữ Latin, chữ có dấu/CJK đắt hơn ⇒ đếm theo byte UTF-8 / 4,
 * làm tròn lên. Dùng cho quyết định inline/nhúng và đo trước/sau (cùng thước ở cả hai phía).
 */
export const estimateTokens = (s: string): number => Math.ceil(Buffer.byteLength(s, "utf8") / 4);

export const shouldInline = (body: string): boolean => estimateTokens(body) < INLINE_MAX_TOKENS;
export const shouldEmbed = (tokens: number): boolean => tokens >= EMBED_MIN_TOKENS;

export const expiresAt = (now: Date, ttlDays = DEFAULT_TTL_DAYS): Date =>
  new Date(now.getTime() + Math.max(1, ttlDays) * 86_400_000);

/** Tóm tắt 1–2 dòng mặc định khi người ghi không đưa: dòng không rỗng đầu tiên, cắt 160 ký tự. */
export function defaultSummary(body: string): string {
  const line = body.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  const pts = [...line.trim()];
  return pts.length <= 160 ? pts.join("") : `${pts.slice(0, 159).join("")}…`;
}

export type Range = { start: number; len: number };

/** `range` của `artifact.get` (ký tự, theo code point); vắng ⇒ từ đầu; luôn ≤ `GET_MAX_CHARS`. */
export function sliceRange(
  body: string,
  range?: Partial<Range> | null,
): { text: string; start: number; end: number; total: number } {
  const pts = [...body];
  const total = pts.length;
  const start = Math.min(Math.max(0, Math.trunc(range?.start ?? 0)), total);
  const len = Math.min(Math.max(1, Math.trunc(range?.len ?? GET_MAX_CHARS)), GET_MAX_CHARS);
  const end = Math.min(total, start + len);
  return { text: pts.slice(start, end).join(""), start, end, total };
}

/** Tham chiếu tới một artifact đã lưu. */
export type ArtifactRef = { key: string; short: string; tokens: number; summary: string };

/** Một đầu vào của phong bì: nhỏ ⇒ nguyên văn; lớn ⇒ tham chiếu + tóm tắt. */
export type HandoffInput = { text: string } | { ref: string; sum: string; tokens: number };

export const inputOf = (body: string, ref: ArtifactRef | null): HandoffInput =>
  ref && !shouldInline(body)
    ? { ref: ref.short, sum: ref.summary, tokens: ref.tokens }
    : { text: body };

/** Phong bì bàn giao gọn `{g,in,sum,c,o,b}` (khoá ngắn để tiết kiệm token). */
export type HandoffEnvelope = {
  g: string;
  in: HandoffInput[];
  sum?: string;
  c?: string[];
  o: "answer" | "delegate";
  b?: number;
};

export const HANDOFF_HINT =
  "Inputs with `ref` are stored artifacts: call MCP tool `artifact.get` with {key, range?} to read only what you need.";

/** Phong bì → chuỗi gửi đi; không có ref nào ⇒ bỏ câu hướng dẫn (không thêm token vô ích). */
export function renderEnvelope(e: HandoffEnvelope): string {
  const body: Record<string, unknown> = { g: e.g, in: e.in };
  if (e.sum) body.sum = e.sum;
  if (e.c?.length) body.c = e.c;
  body.o = e.o;
  if (e.b) body.b = e.b;
  const json = JSON.stringify(body).replace(/</g, "\\u003c");
  return e.in.some((i) => "ref" in i) ? `${json}\n${HANDOFF_HINT}` : json;
}
