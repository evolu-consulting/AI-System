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

/** CR-120 · G3 · `wait_for`: chờ N giờ kể từ lúc tới lượt (không nguồn ngày). */
export const WAIT_FOR_HOURS = { min: 1, max: 8760 } as const;
export const WaitForExecutorSchema = z.strictObject({
  kind: z.literal("wait_for"),
  hours: z.number().int().min(WAIT_FOR_HOURS.min).max(WAIT_FOR_HOURS.max),
});
export type WaitForExecutor = z.infer<typeof WaitForExecutorSchema>;

/** CR-120 · G4 · `wait_event`: chờ sự kiện theo khoá (gói bắn qua `signalEvent`), hết `timeout_h` giờ ⇒ chạy tiếp (ghi "hết hạn"). */
export const WAIT_EVENT_KEY_RE = /^[a-z][a-z0-9_.-]{1,63}$/;
export const WAIT_EVENT_TIMEOUT_H = { min: 1, max: 8760 } as const;
export const WaitEventExecutorSchema = z.strictObject({
  kind: z.literal("wait_event"),
  event: z.string().regex(WAIT_EVENT_KEY_RE),
  timeout_h: z.number().int().min(WAIT_EVENT_TIMEOUT_H.min).max(WAIT_EVENT_TIMEOUT_H.max),
});
export type WaitEventExecutor = z.infer<typeof WaitEventExecutorSchema>;
