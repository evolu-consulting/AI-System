// CR-120 · cr120-community-flows · spec §6: luật thuần của 3 khe Community (không I/O). Máy trạng thái tại khe:
//   post-moderation: agent `screen` → flagged ⇒ review (quản trị) → approved/rejected; sạch ⇒ approved; agent lỗi/hết hạn ⇒ review
//   partner-join:    form (người xin) → review tenant admin → approved (liên kết đối tác) / rejected
//   report:          agent `triage` (loại, mức) → review điều phối viên → hide / warn / dismiss
// Kết quả agent là DỮ LIỆU: chỉ nhận JSON đúng hình; sai hình ⇒ coi như lỗi (đi review, không tự đăng).

export const SLOT_MODERATION = "community.post-moderation";
export const SLOT_JOIN = "community.partner-join";
export const SLOT_REPORT = "community.report";
export const AGENT_SCREEN = "community-screen";
export const AGENT_TRIAGE = "community-triage";
/** Lượt screen chạy quá mốc này (tiến trình chết giữa chừng) ⇒ coi như lỗi ⇒ vào hàng duyệt. */
export const SCREEN_STALE_MS = 2 * 60_000;
export const REMIND_H = 24;
export const ESCALATE_H = 48;

export type Moderation = "none" | "pending" | "approved" | "rejected";
export type Screen = "running" | "clean" | "flagged" | "error";
export type ScreenResult = { flagged: boolean; reason: string | null };
export type TriageKind = "spam" | "abuse" | "contact" | "fraud" | "other";
export type TriageLevel = "low" | "medium" | "high";
export type TriageResult = { kind: TriageKind; level: TriageLevel };
export type ReportAction = "hide" | "warn" | "dismiss";

const KINDS = new Set<string>(["spam", "abuse", "contact", "fraud", "other"]);
const LEVELS = new Set<string>(["low", "medium", "high"]);

/** Đối tượng JSON đầu tiên trong văn bản agent (cho phép bọc ```json). Không có / sai ⇒ null. */
function firstJson(text: string): Record<string, unknown> | null {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try {
    const v: unknown = JSON.parse(text.slice(s, e + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const clip = (v: unknown, n: number): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null;

/** `{"flagged": bool, "reason": string?}` ⇒ kết quả; sai hình ⇒ null (= lỗi). */
export function parseScreen(text: string): ScreenResult | null {
  const o = firstJson(text);
  if (!o || typeof o.flagged !== "boolean") return null;
  return { flagged: o.flagged, reason: clip(o.reason, 1000) };
}

/** `{"kind": …, "level": …}` ⇒ kết quả; ngoài tập ⇒ null. */
export function parseTriage(text: string): TriageResult | null {
  const o = firstJson(text);
  if (!o || typeof o.kind !== "string" || typeof o.level !== "string") return null;
  if (!KINDS.has(o.kind) || !LEVELS.has(o.level)) return null;
  return { kind: o.kind as TriageKind, level: o.level as TriageLevel };
}

/** Kết quả screen ⇒ trạng thái bài. Lỗi/hết hạn (null) ⇒ vào duyệt, KHÔNG tự đăng. */
export function afterScreen(r: ScreenResult | null): { moderation: Moderation; screen: Screen } {
  if (!r) return { moderation: "pending", screen: "error" };
  return r.flagged
    ? { moderation: "pending", screen: "flagged" }
    : { moderation: "approved", screen: "clean" };
}

export type ModRow = {
  moderation: Moderation;
  mod_screen: Screen | null;
  mod_at: string | null;
};

/** Bài đang chờ người duyệt quyết (screen xong mà gắn cờ/lỗi, hoặc screen treo quá hạn). */
export function awaitingReview(r: ModRow, now: number): boolean {
  if (r.moderation !== "pending") return false;
  if (r.mod_screen === "flagged" || r.mod_screen === "error") return true;
  return r.mod_screen === "running" && !!r.mod_at && now - Date.parse(r.mod_at) > SCREEN_STALE_MS;
}

export type DecideError = "NOT_OPEN" | "NOT_REVIEWER" | "ACTION_UNKNOWN";

/** Duyệt bài: chỉ người duyệt, chỉ khi đang chờ duyệt; approve ⇒ approved, reject ⇒ rejected. */
export function decideModeration(
  r: ModRow,
  action: string,
  o: { reviewer: boolean; now: number },
): Moderation | DecideError {
  if (action !== "approve" && action !== "reject") return "ACTION_UNKNOWN";
  if (!o.reviewer) return "NOT_REVIEWER";
  if (!awaitingReview(r, o.now)) return "NOT_OPEN";
  return action === "approve" ? "approved" : "rejected";
}

export function decideJoin(
  status: "pending" | "approved" | "rejected",
  action: string,
  o: { reviewer: boolean },
): "approved" | "rejected" | DecideError {
  if (action !== "approve" && action !== "reject") return "ACTION_UNKNOWN";
  if (!o.reviewer) return "NOT_REVIEWER";
  if (status !== "pending") return "NOT_OPEN";
  return action === "approve" ? "approved" : "rejected";
}

export function decideReport(
  status: "pending" | "resolved",
  action: string,
  o: { reviewer: boolean },
): ReportAction | DecideError {
  if (action !== "hide" && action !== "warn" && action !== "dismiss") return "ACTION_UNKNOWN";
  if (!o.reviewer) return "NOT_REVIEWER";
  if (status !== "pending") return "NOT_OPEN";
  return action;
}

/** Hạn nhắc / chuyển cấp của bước duyệt bài (mốc mở lượt + 24 h / 48 h). */
export function reviewClock(openedAt: string | null, now: number) {
  if (!openedAt) return { due_at: null, overdue: false, escalated: false };
  const t0 = Date.parse(openedAt);
  return {
    due_at: new Date(t0 + REMIND_H * 3_600_000).toISOString(),
    overdue: now > t0 + REMIND_H * 3_600_000,
    escalated: now > t0 + ESCALATE_H * 3_600_000,
  };
}

/** Lời nhắc dữ liệu gửi agent (nội dung người dùng là dữ liệu JSON, không phải chỉ dẫn). */
export const screenPrompt = (p: { title: string; body: string }) =>
  JSON.stringify({ title: p.title.slice(0, 400), body: p.body.slice(0, 4000) });
export const triagePrompt = (r: { reason: string; title: string; body: string }) =>
  JSON.stringify({
    report: r.reason.slice(0, 1000),
    post: { title: r.title.slice(0, 400), body: r.body.slice(0, 4000) },
  });
