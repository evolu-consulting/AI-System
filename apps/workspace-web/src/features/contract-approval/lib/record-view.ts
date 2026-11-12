// CR-127 · U4 · M6 · BR-26 · hồ sơ duyệt: dòng hiển thị của `GET /contracts/:id/approval-record` (thuần).
// Người chỉ xem (`can_read_evidence=false`) chỉ thấy là CÓ bằng chứng, không thấy nội dung; làm thay ghi «A (thay B)».
import type { ApprovalRecord } from "@ai/contracts/pack-contracts";

export type RecordLine = {
  key: string;
  stage: string;
  action: "approve" | "return" | "reject";
  who: string;
  /** «thay {người được giao}» khi làm thay. */
  onBehalf: string | null;
  at: string;
  /** Lý do (Trả lại/Từ chối) hoặc ý kiến; ẩn với người chỉ xem. */
  note: string | null;
  hasEvidence: boolean;
  readable: boolean;
  signatureId: string | null;
  fileIds: readonly string[];
  evidenceId: string | null;
};

export function recordLines(r: ApprovalRecord): RecordLine[] {
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: CR-127 U4 — luật hiển thị gom một chỗ, tách sau khi UI đóng băng
  return r.items.map((i) => {
    const e = i.evidence;
    const readable = e?.readable === true && r.can_read_evidence;
    return {
      key: i.task_id,
      stage: i.stage,
      action: i.action,
      who: e?.by_user.display_name ?? i.actor.display_name ?? "",
      onBehalf: e?.on_behalf_of?.display_name ?? null,
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
