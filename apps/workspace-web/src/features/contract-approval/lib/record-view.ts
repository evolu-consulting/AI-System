// CR-127 · U4 · M6 · BR-26 · hồ sơ duyệt: dòng hiển thị của `GET /contracts/:id/approval-record` (thuần).
// Người chỉ xem (`can_read_evidence=false`) chỉ thấy là CÓ bằng chứng, không thấy nội dung; làm thay ghi «A (thay B)».
import type { ApprovalRecord } from "@ai/contracts/pack-contracts";

export type RecordLine = {
  key: string;
  /** Tên bước cho người dùng; null ⇒ không tra được tên (UI ghi «Bước duyệt»). */
  stage: string | null;
  action: "approve" | "return" | "reject";
  who: string;
  /** «thay {người được giao}» khi làm thay. */
  onBehalf: string | null;
  /** [AUDIT] · Toàn quyền duyệt thay (không phải người/nhóm được giao). */
  override: boolean;
  at: string;
  /** Lý do (Trả lại/Từ chối) hoặc ý kiến; ẩn với người chỉ xem. */
  note: string | null;
  hasEvidence: boolean;
  readable: boolean;
  signatureId: string | null;
  fileIds: readonly string[];
  evidenceId: string | null;
};

/** Mã bước của quy trình (vd `truong-phong`, `step_2`): chữ thường + số + gạch, không dấu cách — KHÔNG phải tên cho người dùng. */
const looksLikeKey = (s: string): boolean => /^[a-z0-9]+([-_][a-z0-9]+)*$/.test(s);

/** Tên bước cho người dùng: tra mã bước trong các bước của thẻ duyệt; không tra được mà trông như mã ⇒ null (UI ghi «Bước duyệt», không lộ mã). */
export function stageName(
  stage: string,
  steps: readonly { key: string; name: string }[] | undefined,
): string | null {
  const hit = steps?.find((x) => x.key === stage);
  if (hit) return hit.name;
  return looksLikeKey(stage) ? null : stage;
}

export function recordLines(
  r: ApprovalRecord,
  steps?: readonly { key: string; name: string }[],
): RecordLine[] {
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: CR-127 U4 — luật hiển thị gom một chỗ, tách sau khi UI đóng băng
  return r.items.map((i) => {
    const e = i.evidence;
    const readable = e?.readable === true && r.can_read_evidence;
    return {
      key: i.task_id,
      stage: stageName(i.stage, steps),
      action: i.action,
      who: e?.by_user.display_name ?? i.actor.display_name ?? "",
      onBehalf: e?.on_behalf_of?.display_name ?? i.on_behalf_of?.display_name ?? null,
      override: i.override === true,
      at: i.at,
      note: readable ? (e?.note ?? i.feedback) : r.can_read_evidence ? i.feedback : null,
      hasEvidence: e !== null,
      readable,
      signatureId: readable ? (e?.signature_attachment_id ?? null) : null,
      fileIds: readable ? (e?.attachment_ids ?? []) : [],
      evidenceId: e?.id ?? null,
    };
  });
}

/** «Đã đổi so với lần trước» — có gì để hiện không (trường hoặc đoạn văn đổi, hoặc ghi chú trả lại). */
export const hasChanges = (c: {
  fields: readonly unknown[];
  clauses: readonly unknown[];
  return_note: string | null;
}): boolean => c.fields.length > 0 || c.clauses.length > 0 || c.return_note !== null;

/** [AUDIT] · hồ sơ trống: bước đang mở (tên bước + người đã chọn duyệt nếu biết) ⇒ «Chưa ai duyệt — đang chờ …». */
export function waitingOf(
  steps?: readonly { name: string; status: string; approver?: { name: string } | null }[],
): { step: string; who: string | null } | null {
  const open = steps?.find((x) => x.status === "open");
  return open ? { step: open.name, who: open.approver?.name ?? null } : null;
}
