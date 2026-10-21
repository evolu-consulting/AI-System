// my-activity-rag · luật thuần (lớp 1) của hai tool `my-activity` / `my-chat-history`: đọc tham số, hạn lưu lịch sử chat, dựng
// tsquery tiếng Việt (bỏ dấu, bỏ hư từ), trích đoạn, gộp hoạt động, dựng đường dẫn. Không I/O, không DB.

export const CHAT_LIMIT_DEFAULT = 8;
export const CHAT_LIMIT_MAX = 20;
export const ACT_LIMIT_DEFAULT = 20;
export const ACT_LIMIT_MAX = 50;
export const RETENTION_DEFAULT_MONTHS = 12;
export const RETENTION_MAX_MONTHS = 120;
/** Ứng viên mới nhất khớp từ khoá trước khi xếp hạng (giới hạn chi phí xếp hạng, Luật 4c). */
export const CHAT_CANDIDATES = 100;
/** Pha 1 của tìm từ khoá: số tin mới nhất quét qua index thời gian (chi phí chặn trên, không phụ thuộc thống kê). */
export const CHAT_RECENT_SCAN = 2000;
export const SNIPPET_CHARS = 280;
export const TERMS_MAX = 8;
export const REF_MAX = 80;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Số nguyên trong [1, max]; vắng/sai ⇒ mặc định. */
export function limitOf(v: unknown, def: number, max: number): number {
  const n = Number(v ?? def);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, max) : def;
}

/** Ngày `YYYY-MM-DD` hợp lệ (theo lịch) ⇒ giữ; khác ⇒ null. */
export function dateArg(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!DATE_RE.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

/** Ngày lịch `YYYY-MM-DD` của `now` theo múi `tz` (để model hiểu "hôm nay"). */
export function localDate(now: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);
}

/** Khoảng ngày (theo lịch tenant); `from > to` ⇒ đổi chỗ. */
export function rangeOf(from: unknown, to: unknown): { from: string | null; to: string | null } {
  const f = dateArg(from);
  const t = dateArg(to);
  return f && t && f > t ? { from: t, to: f } : { from: f, to: t };
}

/** Tenant config `admin.tenants.settings.chat_history_months`: số nguyên 1–120; vắng/sai ⇒ 12. */
export function retentionMonths(raw: unknown): number {
  const n = typeof raw === "string" && /^\d{1,4}$/.test(raw.trim()) ? Number(raw) : raw;
  return typeof n === "number" && Number.isInteger(n) && n >= 1
    ? Math.min(n, RETENTION_MAX_MONTHS)
    : RETENTION_DEFAULT_MONTHS;
}

/** Bỏ dấu + chữ thường TỪNG KÝ TỰ (giữ nguyên độ dài ⇒ vị trí trên chuỗi gốc khớp chuỗi đã gấp). */
export function foldVi(s: string): string {
  let out = "";
  for (const ch of s) {
    const f = ch
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .replace(/[đĐ]/g, "d")
      .toLowerCase();
    out += f.length === ch.length ? f : ch;
  }
  return out;
}

/** Hư từ / từ hỏi (đã bỏ dấu) — không mang nội dung tìm kiếm. */
const STOP = new Set(
  (
    "toi minh ta chung ban anh chi em ho no da dang se co khong chua roi hoi gi nhung cac mot nhieu lan truoc " +
    "nay hom qua ve cua la va voi cho de thi ma nao sao bao lam duoc bi tai tu den o trong ngoai len xuong " +
    "nhe nhi a a ha vay the kia day do ai gium giup xem tim lai biet noi"
  ).split(" "),
);

/** Từ khoá: token [a-z0-9] đã gấp, bỏ hư từ, bỏ trùng, tối đa 8. Chỉ ký tự an toàn ⇒ ghép vào tsquery không cần thoát. */
export function keywords(q: unknown): string[] {
  if (typeof q !== "string") return [];
  const out: string[] = [];
  for (const t of foldVi(q).split(/[^a-z0-9]+/)) {
    if (!t || STOP.has(t) || (t.length < 2 && !/\d/.test(t)) || out.includes(t)) continue;
    out.push(t.slice(0, 40));
    if (out.length >= TERMS_MAX) break;
  }
  return out;
}

/** tsquery cho cấu hình `hub.vi`: ≤ 2 từ ⇒ AND (chính xác); nhiều hơn ⇒ OR (xếp hạng lo phần khớp nhiều từ). */
export function tsQueryOf(terms: readonly string[]): string | null {
  if (terms.length === 0) return null;
  return terms.join(terms.length <= 2 ? " & " : " | ");
}

/** Đoạn trích quanh lần khớp đầu tiên (trên chuỗi gốc), ≤ `max` ký tự; không khớp ⇒ đầu tin. */
export function snippet(content: string, terms: readonly string[], max = SNIPPET_CHARS): string {
  const flat = content.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const folded = foldVi(flat);
  const hits = terms.map((t) => folded.indexOf(t)).filter((i) => i >= 0);
  const at = hits.length ? Math.min(...hits) : 0;
  const start = Math.max(0, Math.min(at - Math.floor(max / 3), flat.length - max));
  return `${start > 0 ? "…" : ""}${flat.slice(start, start + max)}${start + max < flat.length ? "…" : ""}`;
}

export type ChatLinkRow = { conversation_id: string; flow_id: string; room_id: string | null };
/** Đường dẫn chat-web: tin trong phòng ⇒ `/rooms/<id>`; còn lại ⇒ `/c/<hội thoại>?flow=<flow>`. */
export const chatLink = (r: ChatLinkRow): string =>
  r.room_id ? `/rooms/${r.room_id}` : `/c/${r.conversation_id}?flow=${r.flow_id}`;

export const CHAT_ROLES = ["all", "user", "assistant"] as const;
/** Vai tin cần lấy; `user` = câu mình hỏi, `assistant` = câu trả lời cho mình. */
export function rolesOf(v: unknown): ("user" | "assistant")[] {
  return v === "user" ? ["user"] : v === "assistant" ? ["assistant"] : ["user", "assistant"];
}

export const ACTIVITY_OBJECTS = ["all", "contract", "partner", "system"] as const;
export type ActivityObject = (typeof ACTIVITY_OBJECTS)[number];
export const objectOf = (v: unknown): ActivityObject =>
  (ACTIVITY_OBJECTS as readonly unknown[]).includes(v) ? (v as ActivityObject) : "all";

/** Lọc loại thao tác (`field_changed`, `approved`…): chỉ [a-z_], ⇒ mẫu LIKE `%x%`; vắng ⇒ null (mọi loại). */
export function actionPattern(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v
    .trim()
    .toLowerCase()
    .replace(/[^a-z_]/g, "");
  return s ? `%${s.slice(0, 40)}%` : null;
}

/** Tham chiếu bản ghi: uuid ⇒ id; khác ⇒ số hợp đồng (cắt khoảng trắng, ≤ 80). Rỗng ⇒ null. */
export function recordRef(v: unknown): { id: string | null; number: string | null } | null {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, REF_MAX);
  if (!s) return null;
  return UUID_RE.test(s) ? { id: s.toLowerCase(), number: null } : { id: null, number: s };
}

export type ActivityLike = { at: string; object: string; action: string };
/** Gộp nhiều nguồn: mới nhất trước (ổn định theo nguồn khi trùng giờ), cắt `limit`. */
export function mergeActivity<T extends ActivityLike>(lists: readonly T[][], limit: number): T[] {
  return lists
    .flat()
    .map((x, i) => ({ x, i, t: Date.parse(x.at) }))
    .sort((a, b) => b.t - a.t || a.i - b.i)
    .slice(0, limit)
    .map((e) => e.x);
}

/** Đường dẫn Sổ Hợp Tác (contracts-web): HĐ ⇒ `/contracts/<id>`; đối tác ⇒ `/partners?party=<khoá>`; khác ⇒ null. */
export function recordLink(
  object: string,
  refId: string | null,
  party: string | null,
): string | null {
  if (object === "contract" && refId) return `/contracts/${refId}`;
  if (object === "partner" && party) return `/partners?party=${encodeURIComponent(party)}`;
  if (object === "partner" && refId) return `/contracts/${refId}`;
  return null;
}

/** Chi tiết sự kiện gọn cho model: JSON ≤ 300 ký tự; rỗng ⇒ undefined. */
export function compactDetail(data: unknown): string | undefined {
  if (data === null || data === undefined) return undefined;
  const s = typeof data === "string" ? data : JSON.stringify(data);
  if (!s || s === "{}" || s === "null") return undefined;
  return s.length > 300 ? `${s.slice(0, 299)}…` : s;
}
