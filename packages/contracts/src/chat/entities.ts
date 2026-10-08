// UC-01..UC-08, CHAT-AC-33 · hằng + thực thể + request/query kênh Chat↔Hub (spec C1 §3, plan §2.2–§2.4).
// Mọi thực thể là `z.strictObject`: Hub cắt ở biên kênh chat, thừa trường là lỗi (plan §1 Q6).
// Không import I/O: chạy được ở trình duyệt, mock và test.
import { z } from "zod";
import { IsoDateTime, LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX, LIST_Q_MAX, UuidSchema } from "../common";
import { ChatAgentKeySchema } from "./agents";
import { ATTACH_PER_MESSAGE_MAX, AttachmentRefSchema } from "./attachments";
import { CHAT_RUN_ERROR_CODES } from "./errors";

export const CHAT_CONTENT_MAX = 16_000;
export const CHAT_ANSWER_MAX = 64_000;
export const CHAT_TITLE_MAX = 200;
export const CHAT_TITLE_DERIVED_LEN = 40;
export const CHAT_CURSOR_MAX = 200;
export const CHAT_LIMIT_DEFAULT = LIST_LIMIT_DEFAULT;
export const CHAT_LIMIT_MAX = LIST_LIMIT_MAX;
export const CHAT_ASK_CHOICES_MAX = 6;
export const CHAT_ASK_CHOICE_MAX = 200;
export const CHAT_ASK_QUESTION_MAX = 2000;
export const CHAT_ERROR_TEXT_MAX = 500;
export const CHAT_STEP_ID_MAX = 64;
export const CHAT_STEPS_MAX = 50;
/** HUB-FR-45: flow coi là "nghỉ" sau 600 s không hoạt động. */
export const FLOW_IDLE_S = 600;
export const SSE_HEARTBEAT_S = 15;
/** Giữ sự kiện sau khi run kết thúc; quá hạn → 410 `EVENTS_EXPIRED`. */
export const RUN_EVENTS_RETENTION_S = 600;
/** Tiền tố chọn kịch bản của mock (plan §3.3); để ở contract cho e2e/test import. */
export const CHAT_SCN_PREFIX = "#scn:";

export const MESSAGE_ROLES = ["user", "assistant"] as const;
export const STEP_STATUSES = ["ok", "failed"] as const;
export const RUN_SUMMARY_STATUSES = ["finished", "failed", "cancelled"] as const;
export const RUN_STATUSES = ["running", ...RUN_SUMMARY_STATUSES] as const;

const CountSchema = z.number().int().min(0);
const TitleSchema = z.string().min(1).max(CHAT_TITLE_MAX);
/** Tiêu đề ở body request: trim trước khi kiểm 1–200. */
const TitleInputSchema = z.string().trim().min(1).max(CHAT_TITLE_MAX);
export const ChatCursorSchema = z.string().min(1).max(CHAT_CURSOR_MAX);
export const ChatRunErrorCodeSchema = z.enum(CHAT_RUN_ERROR_CODES);
export type ChatRunErrorCode = z.infer<typeof ChatRunErrorCodeSchema>;

export const ConversationSchema = z.strictObject({
  id: UuidSchema,
  title: TitleSchema,
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
  flow_count: CountSchema,
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const StepSummarySchema = z.strictObject({
  step_id: z.string().min(1).max(CHAT_STEP_ID_MAX),
  label: z.string().min(1).max(CHAT_TITLE_MAX),
  status: z.enum(STEP_STATUSES),
  ms: CountSchema,
});
export type StepSummary = z.infer<typeof StepSummarySchema>;

export const RunErrorSchema = z.strictObject({
  code: ChatRunErrorCodeSchema,
  message: z.string().min(1).max(CHAT_ERROR_TEXT_MAX),
  hint: z.string().max(CHAT_ERROR_TEXT_MAX),
});
export type RunError = z.infer<typeof RunErrorSchema>;

export const AskSchema = z.strictObject({
  question: z.string().min(1).max(CHAT_ASK_QUESTION_MAX),
  choices: z.array(z.string().min(1).max(CHAT_ASK_CHOICE_MAX)).max(CHAT_ASK_CHOICES_MAX),
});
export type Ask = z.infer<typeof AskSchema>;

/** `error` khác null ⇔ `status` là `failed`/`cancelled`. */
export const RunSummarySchema = z
  .strictObject({
    id: UuidSchema,
    status: z.enum(RUN_SUMMARY_STATUSES),
    ms: CountSchema,
    steps: z.array(StepSummarySchema).max(CHAT_STEPS_MAX),
    error: RunErrorSchema.nullable(),
  })
  .refine((r) => (r.error !== null) === (r.status !== "finished"), {
    message: "error must be set iff status is failed/cancelled",
    path: ["error"],
  });
export type RunSummary = z.infer<typeof RunSummarySchema>;

// HUB-FR-91 · H2b P1–P2: agent trả lời run `direct`, chốt lúc tạo run; vắng (không `null`) ở run khác.
export const RESPONDER_NAME_MAX = 100;
export const ResponderSchema = z.strictObject({
  key: ChatAgentKeySchema,
  name: z.string().min(1).max(RESPONDER_NAME_MAX),
});
export type Responder = z.infer<typeof ResponderSchema>;

/** Tin user: `content` ≥ 1, `run`/`ask` luôn null. `content` user lưu nguyên văn (kể cả `#scn:`). */
export const MessageSchema = z
  .strictObject({
    id: UuidSchema,
    conversation_id: UuidSchema,
    flow_id: UuidSchema,
    role: z.enum(MESSAGE_ROLES),
    content: z.string().max(CHAT_ANSWER_MAX),
    run_id: UuidSchema.nullable(),
    created_at: IsoDateTime,
    run: RunSummarySchema.nullable(),
    ask: AskSchema.nullable(),
    /** H2b: chỉ tin assistant của run `direct`. */
    responder: ResponderSchema.optional(),
    /** H2c: file gắn vào tin (user: gửi kèm; assistant: file `out/`); vắng khi không có file. */
    attachments: z.array(AttachmentRefSchema).min(1).max(ATTACH_PER_MESSAGE_MAX).optional(),
  })
  .superRefine((m, ctx) => {
    if (m.role !== "user") return;
    if (m.content.length < 1 || m.content.length > CHAT_CONTENT_MAX) {
      ctx.addIssue({ code: "custom", message: "user content 1–16000", path: ["content"] });
    }
    if (m.run !== null) ctx.addIssue({ code: "custom", message: "user has no run", path: ["run"] });
    if (m.ask !== null) ctx.addIssue({ code: "custom", message: "user has no ask", path: ["ask"] });
    if (m.responder !== undefined) {
      ctx.addIssue({ code: "custom", message: "user has no responder", path: ["responder"] });
    }
  });
export type Message = z.infer<typeof MessageSchema>;

export const FlowPreviewSchema = z.strictObject({
  question: MessageSchema,
  answer: MessageSchema.nullable(),
});
export type FlowPreview = z.infer<typeof FlowPreviewSchema>;

export const FlowSchema = z.strictObject({
  id: UuidSchema,
  conversation_id: UuidSchema,
  title: TitleSchema,
  created_at: IsoDateTime,
  last_active_at: IsoDateTime,
  message_count: z.number().int().min(1),
  active_run_id: UuidSchema.nullable(),
  preview: FlowPreviewSchema,
});
export type Flow = z.infer<typeof FlowSchema>;

export const RunSchema = z.strictObject({
  id: UuidSchema,
  conversation_id: UuidSchema,
  flow_id: UuidSchema,
  status: z.enum(RUN_STATUSES),
  started_at: IsoDateTime,
  finished_at: IsoDateTime.nullable(),
  last_event_id: CountSchema,
  error: RunErrorSchema.nullable(),
});
export type Run = z.infer<typeof RunSchema>;

/** Trang cursor: `next_cursor` null = hết. */
export function ChatPageSchema<T extends z.ZodType>(item: T) {
  return z.strictObject({ items: z.array(item), next_cursor: ChatCursorSchema.nullable() });
}
export type ChatPage<T> = { items: T[]; next_cursor: string | null };

const PageQueryShape = {
  cursor: ChatCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(CHAT_LIMIT_MAX).default(CHAT_LIMIT_DEFAULT),
};

/** E5 · `q` trim ≤ 100, rỗng = bỏ; khớp không dấu bằng `matchesQuery`. */
export const ConversationListQuerySchema = z.strictObject({
  q: z
    .string()
    .trim()
    .max(LIST_Q_MAX)
    .transform((v) => (v === "" ? undefined : v))
    .optional(),
  ...PageQueryShape,
});
export type ConversationListQuery = z.infer<typeof ConversationListQuerySchema>;

/** CR-051 · cỡ trang tin/flow ở Chat: lần đầu 30 mục mới nhất, cuộn lên mới tải tiếp (Hỏi AI, phòng, thread, khung flow). */
export const CHAT_RECENT_PAGE = 30;

/** E10 · CR-051 (chỉ thêm): `order=desc` ⇒ mới nhất trước, `next_cursor` = trang cũ hơn; vắng = `asc` như cũ. */
export const FlowListQuerySchema = z.strictObject({
  ...PageQueryShape,
  order: z.enum(["asc", "desc"]).default("asc"),
});
export type FlowListQuery = z.infer<typeof FlowListQuerySchema>;

/** E11 · không `flow_id` = mọi flow của hội thoại. */
export const MessageListQuerySchema = z.strictObject({
  flow_id: UuidSchema.optional(),
  ...PageQueryShape,
});
export type MessageListQuery = z.infer<typeof MessageListQuerySchema>;

/** E6 · client tính `title = deriveTitle(content)` của tin đầu. */
export const ConversationCreateRequestSchema = z.strictObject({ title: TitleInputSchema });
export type ConversationCreateRequest = z.infer<typeof ConversationCreateRequestSchema>;

/** E8 */
export const ConversationUpdateRequestSchema = z.strictObject({ title: TitleInputSchema });
export type ConversationUpdateRequest = z.infer<typeof ConversationUpdateRequestSchema>;

export const MESSAGE_SELECTION_MAX = 16_000;
export const MESSAGE_PAGE_URL_MAX = 2_048;
export const MESSAGE_PAGE_TEXT_MAX = 50_000;

/** HUB-FR-11 · ngữ cảnh trang (nguồn fallback `$selection`, `$page.*`) — H2a plan §2.1. Không trim: giữ nguyên văn bản người dùng chọn. */
export const MessageContextSchema = z.strictObject({
  selection: z.string().min(1).max(MESSAGE_SELECTION_MAX).optional(),
  page_url: z
    .string()
    .max(MESSAGE_PAGE_URL_MAX)
    .regex(/^https?:\/\//)
    .optional(),
  page_text: z.string().min(1).max(MESSAGE_PAGE_TEXT_MAX).optional(),
});
export type MessageContext = z.infer<typeof MessageContextSchema>;

/** E12 · không `flow_id` → flow mới (C1-R01); `context` tuỳ chọn (H2a), `attachment_ids` tuỳ chọn (H2c) — chỉ thêm. */
export const SendMessageRequestSchema = z.strictObject({
  content: z.string().trim().min(1).max(CHAT_CONTENT_MAX),
  flow_id: UuidSchema.optional(),
  context: MessageContextSchema.optional(),
  /** H2c: id file đã upload (1–10, không trùng); vắng khi không file. */
  attachment_ids: z
    .array(UuidSchema)
    .min(1)
    .max(ATTACH_PER_MESSAGE_MAX)
    .refine((ids) => new Set(ids).size === ids.length, "duplicate")
    .optional(),
});
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;

/** Header response của E12 (stream SSE). */
export const RUN_ID_HEADER = "X-Run-Id";
export const FLOW_ID_HEADER = "X-Flow-Id";
export const MESSAGE_ID_HEADER = "X-Message-Id";
/** E13 · header thắng query khi có cả hai; sai định dạng = 0 (spec §9 M8). */
export const LAST_EVENT_ID_HEADER = "Last-Event-ID";
export const LAST_EVENT_ID_QUERY = "last_event_id";
