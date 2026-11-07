// CR-122 · p22 · cài đặt nền tảng "Số bước tối đa của một quy trình": `GET /process-editor/limits` (admin) · `PUT` (platform_admin).
// Mặc định 22 (`PROCESS_STAGES_DEFAULT`), trần cứng 50 (`PROCESS_STAGES_CEILING`, cũng là CHECK DB — migration hub 0115).
import { z } from "zod";
import { PROCESS_STAGES_CEILING, PROCESS_STAGES_DEFAULT } from "../chat/processes";

export const ProcessLimitsSchema = z.strictObject({
  /** Số bước (stage) tối đa hiệu lực của một quy trình. */
  stages_max: z.number().int().min(1).max(PROCESS_STAGES_CEILING),
  /** Trần cứng — ô nhập cài đặt không vượt. */
  ceiling: z.literal(PROCESS_STAGES_CEILING),
  default: z.literal(PROCESS_STAGES_DEFAULT),
});
export type ProcessLimits = z.infer<typeof ProcessLimitsSchema>;

export const SaveProcessLimitsRequestSchema = z.strictObject({
  stages_max: z.number().int().min(1).max(PROCESS_STAGES_CEILING),
});
export type SaveProcessLimitsRequest = z.infer<typeof SaveProcessLimitsRequestSchema>;

/** `PROCESS_DEF_INVALID` do vượt số bước tối đa: `paths = ["stages"]` + trần hiện hành. */
export const StagesLimitDetailsSchema = z.strictObject({
  paths: z.tuple([z.literal("stages")]),
  stages_max: z.number().int().min(1).max(PROCESS_STAGES_CEILING),
});

/** Số bước tối đa → câu lỗi "Quy trình tối đa N bước" lấy `max` từ `details.stages_max` của `PROCESS_DEF_INVALID`. */
export const stagesMaxFromDetails = (d: unknown): number | null => {
  const v = typeof d === "object" && d !== null ? (d as { stages_max?: unknown }).stages_max : null;
  return typeof v === "number" && Number.isInteger(v) ? v : null;
};
