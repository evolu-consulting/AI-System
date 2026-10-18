// ADM-FR-66 · ADM-FR-71 · P-b2: props chung của các phần form giai đoạn (tách từ StageForm — TECH-DEBT #136).
import type { EditorRefs } from "../../hooks/use-editor-refs";
import type { DraftErrors, StageDraft } from "../../lib/def-form";
import type { InputDraft } from "../../lib/sources-form";

export type StageFormProps = {
  stage: StageDraft;
  index: number;
  all: StageDraft[];
  /** Nguồn khai báo ở quy trình (P-b). */
  defSources: readonly string[];
  /** P-d1 · input khai báo của quy trình (nguồn ngày của "Chờ tới ngày"). */
  defInputs?: readonly InputDraft[];
  errors: DraftErrors;
  readOnly: boolean;
  refs: EditorRefs;
  /** Câu lỗi đã dịch của lần đổi bước vừa bị từ chối (vd. bước đầy). */
  stepNotice?: string;
  onChange: (patch: Partial<StageDraft>) => void;
  /** Đổi thứ tự trong bước (Lên/Xuống). */
  onMove: (dir: -1 | 1) => void;
  /** Chuyển sang bước `step` (0-based). */
  onStep: (step: number) => void;
  onSplit: () => void;
  onRemove: () => void;
};
