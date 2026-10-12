// HUB-FR-112 · CR-056 · sự kiện `/me/stream` của quy trình (plan-contract §5): hằng riêng, không đổi ME_STREAM_EVENTS.
import { z } from "zod";
import { CountSchema, UuidSchema } from "../common";
import {
  ProcessRunStatusSchema,
  ProcessStepSchema,
  StageIdxSchema,
  TaskKindSchema,
  TaskResultSchema,
} from "./processes";
import { ProcessNoticeSchema } from "./processes-entities";

export const ME_STREAM_PROCESS_EVENTS = [
  "process.updated",
  "review_task.created",
  "review_task.closed",
  "process.notice",
] as const;
export type MeStreamProcessEventName = (typeof ME_STREAM_PROCESS_EVENTS)[number];

export const ProcessUpdatedEventDataSchema = z.strictObject({
  process_run_id: UuidSchema,
  status: ProcessRunStatusSchema,
  stage_idx: StageIdxSchema,
  /** P-b2 · bước hiện tại của run. */
  step: ProcessStepSchema.optional(),
});
export const ReviewTaskCreatedEventDataSchema = z.strictObject({
  task_id: UuidSchema,
  kind: TaskKindSchema,
  process_run_id: UuidSchema,
});
export const ReviewTaskClosedEventDataSchema = z.strictObject({
  task_id: UuidSchema,
  result: TaskResultSchema,
});
export const ProcessNoticeEventDataSchema = z.strictObject({
  notice: ProcessNoticeSchema,
  unread: CountSchema,
});
export type ProcessUpdatedEventData = z.infer<typeof ProcessUpdatedEventDataSchema>;
export type ReviewTaskCreatedEventData = z.infer<typeof ReviewTaskCreatedEventDataSchema>;
export type ReviewTaskClosedEventData = z.infer<typeof ReviewTaskClosedEventDataSchema>;
export type ProcessNoticeEventData = z.infer<typeof ProcessNoticeEventDataSchema>;

export const MeStreamProcessEventSchema = z.discriminatedUnion("event", [
  z.strictObject({ event: z.literal("process.updated"), data: ProcessUpdatedEventDataSchema }),
  z.strictObject({
    event: z.literal("review_task.created"),
    data: ReviewTaskCreatedEventDataSchema,
  }),
  z.strictObject({ event: z.literal("review_task.closed"), data: ReviewTaskClosedEventDataSchema }),
  z.strictObject({ event: z.literal("process.notice"), data: ProcessNoticeEventDataSchema }),
]);
export type MeStreamProcessEvent = z.infer<typeof MeStreamProcessEventSchema>;

/** `data` là chuỗi SSE (JSON) hoặc object đã parse; JSON hỏng, event lạ, khoá thừa ⇒ `null` (không ném). */
export function parseMeStreamProcessEvent(
  event: string,
  data: unknown,
): MeStreamProcessEvent | null {
  let json: unknown = data;
  if (typeof data === "string") {
    try {
      json = JSON.parse(data);
    } catch {
      return null;
    }
  }
  const r = MeStreamProcessEventSchema.safeParse({ event, data: json });
  return r.success ? r.data : null;
}
