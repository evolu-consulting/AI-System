// CR-122 · N2 · FLOW2-FR-26 · `POST /process-defs/bridge-suggest` — AI (qua Agent Hub) đề xuất chèn node Ghi giá trị (`set`) làm cầu nối
// giữa hai bước lệch giao diện. Chỉ ĐỀ XUẤT: endpoint không lưu gì; người dùng xem trước rồi Nhận (chèn bằng `insertBridgeStage`) / Bỏ.
// AI chỉ nhận tên + kiểu trường (không dữ liệu bản ghi).
import { z } from "zod";
import { PROCESS_STAGES_MAX, STAGE_KEY_RE } from "../chat/processes";
import { FlowEdgeWarningSchema } from "./process-flow-edges";
import {
  type ProcessDef,
  ProcessDefInputBaseSchema,
  ProcessDefSchema,
  ProcessStageDefSchema,
} from "./processes";

/**
 * Response `POST/PUT /process-defs`: `ProcessDef` + `warnings` (cạnh lệch NHẸ — sai kiểu; lưu vẫn được). Thiếu trường bắt buộc ⇒ 422
 * `FLOW_EDGE_MISSING`. `warnings` vắng khi không có cạnh lệch.
 */
export const ProcessDefSavedSchema = ProcessDefSchema.extend({
  warnings: z
    .array(FlowEdgeWarningSchema)
    .max(PROCESS_STAGES_MAX * 3)
    .optional(),
});
export type ProcessDefSaved = ProcessDef & { warnings?: z.infer<typeof FlowEdgeWarningSchema>[] };

/** Trần độ dài câu giải thích / lý do (mỗi ngôn ngữ). */
export const BRIDGE_TEXT_MAX = 400;

export const BridgeSuggestRequestSchema = z.strictObject({
  /** Bản nháp đang sửa (chưa cần lưu). */
  def: ProcessDefInputBaseSchema,
  /** Khoá stage trước / sau của cạnh cần cầu nối (phải là một cạnh của flow). */
  from: z.string().regex(STAGE_KEY_RE),
  to: z.string().regex(STAGE_KEY_RE),
});
export type BridgeSuggestRequest = z.infer<typeof BridgeSuggestRequestSchema>;

const Text = z.string().trim().min(1).max(BRIDGE_TEXT_MAX);

export const BridgeSuggestResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    /** Stage `set` đầy đủ (`step` = bước mới của cầu nối); chèn bằng `insertBridgeStage(def.stages, from, to, stage)`. */
    stage: ProcessStageDefSchema,
    explain_vi: Text,
    explain_en: Text,
  }),
  z.strictObject({ ok: z.literal(false), reason_vi: Text, reason_en: Text }),
]);
export type BridgeSuggestResponse = z.infer<typeof BridgeSuggestResponseSchema>;
