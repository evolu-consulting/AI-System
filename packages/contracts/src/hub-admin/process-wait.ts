// CR-103 · tách từ `./processes` (giữ file ≤ 400 dòng): nguồn ngày + executor `wait_until` (P-d1 · PD-R13).
import { z } from "zod";
import {
  STAGE_KEY_RE,
  WAIT_OFFSET_DAYS,
  WAIT_TIME_DEFAULT,
  WaitTimeSchema,
} from "../chat/processes";
import { FIELD_KEY_RE } from "./process-tools";
import { InputKeySchema } from "./sources";
/** P-d1 · nguồn ngày của `wait_until`: input run kiểu `date` hoặc field `date` của output stage ở bước nhỏ hơn. */
export const WaitFromSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("input"), key: InputKeySchema }),
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
/** CR-122 · E3 · sự kiện khác cũng kết thúc chờ (vd `esign.declined`, `esign.voided`) — tối đa 3. */
export const WAIT_EVENT_ALSO_MAX = 3;
/** Khoá rẽ khi hết hạn chờ (field output `event` = `timeout`). */
export const WAIT_EVENT_TIMEOUT_KEY = "timeout";
export const WaitEventExecutorSchema = z.strictObject({
  kind: z.literal("wait_event"),
  event: z.string().regex(WAIT_EVENT_KEY_RE),
  timeout_h: z.number().int().min(WAIT_EVENT_TIMEOUT_H.min).max(WAIT_EVENT_TIMEOUT_H.max),
  also_events: z.array(z.string().regex(WAIT_EVENT_KEY_RE)).max(WAIT_EVENT_ALSO_MAX).optional(),
  /**
   * CR-122 · E3 · rẽ theo sự kiện đã nhận (`on` = khoá sự kiện hoặc `timeout`) ⇒ bước `goto_step` (> bước của mình). Vắng ⇒ bước kế.
   * Output của stage có field `event` (khoá đã nhận / `timeout`) để node sau đọc.
   */
  branches: z
    .array(
      z.strictObject({
        on: z.string().regex(WAIT_EVENT_KEY_RE),
        goto_step: z.number().int().min(0).max(255),
      }),
    )
    .max(WAIT_EVENT_ALSO_MAX + 2)
    .optional(),
});

/** Khoá sự kiện mà stage `wait_event` chờ (chính + phụ). */
export const waitEventKeys = (e: { event: string; also_events?: readonly string[] }): string[] => [
  e.event,
  ...(e.also_events ?? []),
];
export type WaitEventExecutor = z.infer<typeof WaitEventExecutorSchema>;
