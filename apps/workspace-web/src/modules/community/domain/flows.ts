// CR-120 · cr120-community-flow-ui · mapper thuần cho 3 luồng Community (duyệt bài, xin tham gia, báo cáo): từ dữ liệu server sang
// NGÔN NGỮ NGHIỆP VỤ (khoá i18n + tham số). Không có từ kỹ thuật nào lọt ra UI; UI chỉ dịch khoá.
import type { ModerationItem, Report } from "@ai/contracts/community";

export type NoteTone = "ok" | "soon" | "late" | "grey";
export type ModerationNote = {
  tone: NoteTone;
  /** Khoá i18n nhãn trạng thái. */
  labelKey: string;
  params?: Record<string, string>;
  /** Khoá i18n câu "vì sao + bước kế". */
  whyKey: string;
  /** Gợi ý sửa bài (luôn có khi bài có thể sửa lại). */
  hintKey: string | null;
};

/** Trạng thái duyệt của MỘT bài của tôi (null = bài không qua duyệt ⇒ không hiện gì). */
export function moderationNote(m: ModerationItem): ModerationNote | null {
  const hint = "community.flows.mod.editHint";
  if (m.moderation === "none") return null;
  if (m.moderation === "approved")
    return {
      tone: "ok",
      labelKey: "community.flows.mod.approved",
      whyKey: "community.flows.mod.approvedWhy",
      hintKey: hint,
    };
  if (m.moderation === "rejected") {
    const reason = (m.feedback ?? m.reason ?? "").trim();
    return reason
      ? {
          tone: "late",
          labelKey: "community.flows.mod.rejected",
          params: { reason },
          whyKey: "community.flows.mod.rejectedWhy",
          hintKey: hint,
        }
      : {
          tone: "late",
          labelKey: "community.flows.mod.rejectedNoReason",
          whyKey: "community.flows.mod.rejectedWhy",
          hintKey: hint,
        };
  }
  return {
    tone: "soon",
    labelKey: "community.flows.mod.pending",
    whyKey: !m.awaitingReview
      ? "community.flows.mod.pendingChecking"
      : aiUnchecked(m)
        ? "community.flows.mod.pendingAiUnchecked"
        : "community.flows.mod.pendingReview",
    hintKey: hint,
  };
}

/** UX-S5 · bài đã sang người duyệt vì AI không kiểm được (lỗi / hết hạn / không mở được flow), không phải vì AI gắn cờ. */
const aiUnchecked = (m: ModerationItem): boolean =>
  m.awaitingReview && (m.screen === "running" || m.screen === "error");

/** Còn bài đang chờ (cần nạp lại định kỳ để thấy kết quả duyệt mà không phải tải lại trang). */
export const hasOpenModeration = (
  items: ReadonlyMap<string, ModerationItem> | undefined,
): boolean => !!items && [...items.values()].some((m) => m.moderation === "pending");

/** Khoá i18n lý do bài vào hàng chờ (người duyệt đọc). */
export function queueReasonKey(m: ModerationItem): {
  key: string;
  params?: Record<string, string>;
} {
  if (!m.awaitingReview) return { key: "community.flows.review.checking" };
  if (m.screen === "flagged")
    return m.reason
      ? { key: "community.flows.review.flagged", params: { reason: m.reason } }
      : { key: "community.flows.review.flaggedNoReason" };
  // screen null = flow đã mở lượt cho người duyệt (bình thường); còn lại = AI chưa kiểm được
  return m.screen === null
    ? { key: "community.flows.review.byFlow" }
    : { key: "community.flows.review.unchecked" };
}

/** Lỗi tranh chấp (người khác đã xử lý / trùng yêu cầu): HTTP 409. */
export const isConflict = (e: unknown): boolean =>
  typeof e === "object" && e !== null && (e as { status?: unknown }).status === 409;

/** Gộp bài của tôi theo id (MỘT lần gọi cho cả danh sách, không gọi theo từng bài). */
export const byPostId = (items: readonly ModerationItem[]): ReadonlyMap<string, ModerationItem> =>
  new Map(items.map((i) => [i.id, i]));

export const reportKindKey = (r: Report): string =>
  r.triage === "running"
    ? "community.flows.reports.triaging"
    : `community.flows.reports.kind.${r.kind ?? "other"}`;

export const reportLevelKey = (r: Report): string | null =>
  r.level ? `community.flows.reports.level.${r.level}` : null;
