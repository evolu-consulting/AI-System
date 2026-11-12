// CR-127 · U4 · BR-20…26 · `EvidenceInput` (ý kiến + chữ ký tay + tệp): luật thuần của ô bằng chứng khi quyết một việc.
// Chế độ theo bước: «Chỉ ý kiến» (opinion) hay «Ý kiến + chữ ký hoặc tệp» (opinion_plus — `EVIDENCE_REQUIRED` nếu thiếu).
import {
  EVIDENCE_FILES_MAX,
  EVIDENCE_NOTE_MAX,
  type EvidenceInput,
  type EvidenceMode,
} from "@ai/contracts/chat";
import type { FlowActionInput } from "@ai/contracts/flow";

export type EvidenceDraft = {
  note: string;
  /** id tệp chữ ký đã tải lên (PNG vẽ tay) hoặc null. */
  signatureId: string | null;
  fileIds: readonly string[];
};
export const EMPTY_EVIDENCE: EvidenceDraft = { note: "", signatureId: null, fileIds: [] };

/** Yêu cầu bằng chứng của một hành động: `null` = hành động không có ô bằng chứng. */
export type EvidenceRule = { mode: EvidenceMode; signature: boolean; files: boolean };

/** Hành động quyết của việc duyệt: bước đặt `evidence_mode` ⇒ cả ba đều mở ô ý kiến (một nguồn: `task.evidence_mode`). */
const DECISION_KEYS = new Set(["approve", "return", "reject"]);

/**
 * `mode` (= `FlowTask.evidence_mode`, bước đặt «Chỉ ý kiến»/«Ý kiến + chữ ký hoặc tệp») quyết có hỏi bằng chứng hay không:
 * có ⇒ Duyệt/Trả lại/Từ chối đều hỏi (opinion_plus thêm chữ ký + tệp). Không có `mode` ⇒ theo `input` của hành động như cũ.
 */
export function evidenceRuleOf(
  input: FlowActionInput | undefined,
  mode?: EvidenceMode,
  key?: string,
): EvidenceRule | null {
  if (mode && key !== undefined && DECISION_KEYS.has(key))
    return { mode, signature: mode === "opinion_plus", files: mode === "opinion_plus" };
  if (!input || input.kind !== "evidence") return null;
  const m: EvidenceMode = mode ?? (input.required ? "opinion_plus" : "opinion");
  return { mode: m, signature: input.signature, files: input.files };
}

export type EvidenceIssue = "note" | "noteLong" | "proof" | "tooManyFiles" | null;

/** Nhập đủ chưa: ý kiến 1..4000; `opinion_plus` cần thêm chữ ký hoặc ≥ 1 tệp. */
export function evidenceIssue(d: EvidenceDraft, r: EvidenceRule): EvidenceIssue {
  const note = d.note.trim();
  if (note === "") return "note";
  if (note.length > EVIDENCE_NOTE_MAX) return "noteLong";
  if (d.fileIds.length > EVIDENCE_FILES_MAX) return "tooManyFiles";
  if (r.mode === "opinion_plus" && d.signatureId === null && d.fileIds.length === 0) return "proof";
  return null;
}

/** Bản nháp ⇒ thân gửi server (không gửi trường rỗng; chế độ chỉ ý kiến bỏ chữ ký/tệp nếu ô không bật). */
export function evidenceBody(d: EvidenceDraft, r: EvidenceRule): EvidenceInput {
  return {
    note: d.note.trim(),
    ...(r.signature && d.signatureId ? { signature_attachment_id: d.signatureId } : {}),
    ...(r.files && d.fileIds.length > 0 ? { attachment_ids: [...d.fileIds] } : {}),
  };
}
