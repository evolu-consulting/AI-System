// CR-103 · tách từ `./processes` (giữ file ≤ 400 dòng): nguồn ngày + executor `wait_until` (P-d1 · PD-R13).
import { z } from "zod";
import {
  STAGE_KEY_RE,
  WAIT_OFFSET_DAYS,
  WAIT_TIME_DEFAULT,
  WaitTimeSchema,
} from "../chat/processes";
import { FIELD_KEY_RE } from "./process-tools";
import { SourceKeySchema } from "./sources";
/** P-d1 · nguồn ngày của `wait_until`: input run kiểu `date` hoặc field `date` của output stage ở bước nhỏ hơn. */
export const WaitFromSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("input"), key: SourceKeySchema }),
  z.strictObject({
    kind: z.literal("field"),
    stage_key: z.string().regex(STAGE_KEY_RE),
    field: z.string().regex(FIELD_KEY_RE),
  }),
]);
export type WaitFrom = z.infer<typeof WaitFromSchema>;
export const WaitUntilExecutorSchema = z.strictObject({
  kind: z.literal("wait_until"),
  from: WaitFromSchema,
  offset_days: z.number().int().min(WAIT_OFFSET_DAYS.min).max(WAIT_OFFSET_DAYS.max),
  time: WaitTimeSchema.default(WAIT_TIME_DEFAULT),
});
