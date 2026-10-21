// gap-a1 · luật thuần của khối "Quản lý" trên trang chi tiết HĐ: đọc ô hoa hồng %, dựng dòng lịch sử, chọn câu lỗi theo mã máy chủ.
import type { HistoryItem } from "@ai/contracts";
import { ApiError } from "@ai/web-kit/http";

/** Ô hoa hồng: trống ⇒ xoá (null); số 0–100, tối đa 2 chữ số thập phân (dấu phẩy hoặc chấm). */
export function parsePct(text: string): { ok: true; value: number | null } | { ok: false } {
  const s = text.trim().replace(",", ".");
  if (s === "") return { ok: true, value: null };
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return { ok: false };
  const v = Number(s);
  return v >= 0 && v <= 100 ? { ok: true, value: v } : { ok: false };
}

export type FieldDiff = { key: string; old: string; new: string };
export type HistoryLine = {
  /** `contracts.gapa1.ev.<kind>`; kind lạ ⇒ `other` (hiện mã gốc). */
  kind: string;
  type: string;
  actor: string | null;
  at: string;
  diffs: FieldDiff[];
  /** Cặp giá trị cho `owner_assigned` (id người) / `commission_edited` (%). */
  from: string | null;
  to: string | null;
};

const KNOWN = new Set([
  "field_edited",
  "owner_assigned",
  "commission_edited",
  "summary_generated",
  "review_saved",
  "item_product_set",
  "parent_changed",
  "approval_started",
  "approved",
  "feedback",
  "extract_requested",
  "created_manual",
  "handled",
  "schedule_set",
  "uploaded",
]);

const text = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

function diffsOf(data: unknown): FieldDiff[] {
  const ch = (data as { changes?: unknown } | null)?.changes;
  if (!Array.isArray(ch)) return [];
  return ch
    .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
    .map((c) => ({ key: text(c.key), old: text(c.old), new: text(c.new) }));
}

export function historyLine(h: HistoryItem): HistoryLine {
  const d = (h.data ?? {}) as { from?: unknown; to?: unknown };
  const pair = h.type === "owner_assigned" || h.type === "commission_edited";
  return {
    kind: KNOWN.has(h.type) ? h.type : "other",
    type: h.type,
    actor: h.actor_user_id,
    at: h.at,
    diffs: h.type === "field_edited" ? diffsOf(h.data) : [],
    from: pair && d.from != null ? text(d.from) : null,
    to: pair && d.to != null ? text(d.to) : null,
  };
}

/** Khoá i18n (`contracts.gapa1.err.*`) theo mã lỗi máy chủ; 409 cũ ⇒ "vừa được cập nhật". */
export function manageErrorKey(e: unknown): string {
  if (e instanceof ApiError) {
    const byCode: Record<string, string> = {
      EXTRACT_BUSY: "busy",
      EXTRACT_NOT_ALLOWED: "notAllowed",
      NO_SOURCE: "noSource",
      AGENT_UNAVAILABLE: "aiUnavailable",
      SUMMARY_UNAVAILABLE: "aiUnavailable",
      SUMMARY_NOT_ALLOWED: "summaryNotAllowed",
      AI_CAP_EXCEEDED: "cap",
      UPLOAD_QUOTA: "cap",
      OWNER_INVALID: "ownerInvalid",
      COMMISSION_NOT_ALLOWED: "commissionNotAllowed",
      CONTRACT_STALE: "stale",
    };
    const k = e.code ? byCode[e.code] : undefined;
    if (k) return `contracts.gapa1.err.${k}`;
    if (e.status === 429) return "contracts.gapa1.err.cap";
    if (e.code === "NETWORK_ERROR") return "contracts.errors.network";
    if (e.status === 409) return "contracts.errors.conflict";
  }
  return "contracts.errors.unknown";
}
