// UC-08, CHAT-AC-06, CHAT-AC-28, CHAT-AC-33 · 7 sự kiện SSE kênh chat, envelope `ChatEvent` (plan §2.5).
// Payload strict: không `agent`/`provider`/`model`/`usage` (plan §1 Q6). `id` liên tiếp từ 1 theo run.
import { z } from "zod";
import { UuidSchema } from "../common";
import {
  AskSchema,
  CHAT_ANSWER_MAX,
  CHAT_ERROR_TEXT_MAX,
  CHAT_STEP_ID_MAX,
  CHAT_TITLE_MAX,
  ChatRunErrorCodeSchema,
  ResponderSchema,
  STEP_STATUSES,
} from "./entities";

export const CHAT_DELTA_MAX = 4000;
export const QUOTA_STATES = ["ok", "warn", "over"] as const;
export const CHAT_EVENT_NAMES = [
  "run.started",
  "step.started",
  "step.finished",
  "delta",
  "ask",
  "run.finished",
  "run.failed",
] as const;
export type ChatEventName = (typeof CHAT_EVENT_NAMES)[number];
/** Sự kiện kết thúc: mỗi stream có đúng một, là sự kiện cuối. */
export const TERMINAL_EVENTS = ["run.finished", "run.failed"] as const;

const MsSchema = z.number().int().min(0);
const StepIdSchema = z.string().min(1).max(CHAT_STEP_ID_MAX);

/** `warn` khi `pct` ≥ 80, `over` khi ≥ 100; không chặn run. */
export const RunStartedDataSchema = z.strictObject({
  run_id: UuidSchema,
  flow_id: UuidSchema,
  quota: z.strictObject({ state: z.enum(QUOTA_STATES), pct: z.number().int().min(0) }),
  /** H2b: chỉ run `direct`. */
  responder: ResponderSchema.optional(),
});
export const StepStartedDataSchema = z.strictObject({
  step_id: StepIdSchema,
  label: z.string().min(1).max(CHAT_TITLE_MAX),
});
export const StepFinishedDataSchema = z.strictObject({
  step_id: StepIdSchema,
  status: z.enum(STEP_STATUSES),
  ms: MsSchema,
});
export const DeltaDataSchema = z.strictObject({ text: z.string().min(1).max(CHAT_DELTA_MAX) });
/** Cùng dạng `Ask` lưu trong `Message.ask`; ngay sau là `run.finished`. */
export const AskDataSchema = AskSchema;
/** `content` = nối mọi `delta` đã phát; `ms` = thời lượng run. */
export const RunFinishedDataSchema = z.strictObject({
  run_id: UuidSchema,
  message_id: UuidSchema,
  content: z.string().max(CHAT_ANSWER_MAX),
  ms: MsSchema,
});
export const RunFailedDataSchema = z.strictObject({
  run_id: UuidSchema,
  message_id: UuidSchema,
  code: ChatRunErrorCodeSchema,
  message: z.string().min(1).max(CHAT_ERROR_TEXT_MAX),
  hint: z.string().max(CHAT_ERROR_TEXT_MAX),
});

const EventIdSchema = z.number().int().min(1);

function envelope<N extends ChatEventName, D extends z.ZodType>(event: N, data: D) {
  return z.strictObject({ id: EventIdSchema, event: z.literal(event), data });
}

export const ChatEventSchema = z.discriminatedUnion("event", [
  envelope("run.started", RunStartedDataSchema),
  envelope("step.started", StepStartedDataSchema),
  envelope("step.finished", StepFinishedDataSchema),
  envelope("delta", DeltaDataSchema),
  envelope("ask", AskDataSchema),
  envelope("run.finished", RunFinishedDataSchema),
  envelope("run.failed", RunFailedDataSchema),
]);
export type ChatEvent = z.infer<typeof ChatEventSchema>;
export type ChatEventOf<N extends ChatEventName> = Extract<ChatEvent, { event: N }>;
export type RunStartedData = z.infer<typeof RunStartedDataSchema>;
export type StepStartedData = z.infer<typeof StepStartedDataSchema>;
export type StepFinishedData = z.infer<typeof StepFinishedDataSchema>;
export type DeltaData = z.infer<typeof DeltaDataSchema>;
export type AskData = z.infer<typeof AskDataSchema>;
export type RunFinishedData = z.infer<typeof RunFinishedDataSchema>;
export type RunFailedData = z.infer<typeof RunFailedDataSchema>;

/** Khung SSE chưa parse JSON (nhiều dòng `data:` nối bằng `\n`). */
export type RawSseEvent = { id: string | null; event: string; data: string };

/** Dòng chú thích heartbeat, phát mỗi `SSE_HEARTBEAT_S`; parser bỏ qua. */
export const SSE_PING_FRAME = ": ping\n\n";
export const SSE_CONTENT_TYPE = "text/event-stream; charset=utf-8";
