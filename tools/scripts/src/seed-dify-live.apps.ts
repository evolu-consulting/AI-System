// ADM-FR-21 · HUB-FR-89 · X1 plan §5.3: bảng 5 app Dify cho `seed:dify` — chỉ cấu trúc (key workflow, input, command),
// KHÔNG key. Cú pháp input map theo contract thật (K5): `{source:"arg",value}` · `{source:"const",value}` · nguồn ngữ cảnh.

export const SEED_APPS = [
  "chatbot",
  "translate",
  "gmail-summary",
  "email-reply",
  "screenshot-ask",
] as const;
export type SeedApp = (typeof SEED_APPS)[number];

/** Danh sách trắng: tên biến env chứa key của từng app (cũng là tên secret Admin, K6). */
export const ENV_KEY: Record<SeedApp, string> = {
  chatbot: "DIFY_KEY_CHATBOT",
  translate: "DIFY_KEY_TRANSLATE",
  "gmail-summary": "DIFY_KEY_GMAIL",
  "email-reply": "DIFY_KEY_EMAILREPLY",
  "screenshot-ask": "DIFY_KEY_SCREENSHOTASK",
};
export const API_URL_VAR = "DIFY_API_URL";

export type Localized = { vi: string; en: string };
export type WfInput = {
  name: string;
  type: "text" | "file";
  required: boolean;
  description: string;
};
export type ArgFallback = "selection" | "page_url" | "page_text";
/** Dạng đã chuẩn hoá như API trả về (default/fallback `null`, `rest` tường minh) để so sánh idempotent. */
export type ArgSpec = {
  name: string;
  description: Localized;
  default: string | null;
  fallback: ArgFallback | null;
  rest: boolean;
};
export type MapEntry =
  | { source: "arg" | "const"; value: string }
  | { source: "selection" | "page_url" | "page_text" | "attachment" | "user_id" | "tenant_id" };
export type OutputSpec = { field: string; render: "markdown" | "text" | "json" };

export type WorkflowSpec = {
  key: string;
  name: string;
  description: string;
  app_type: "workflow" | "chat" | "agent";
  input_schema: WfInput[];
  output_field: string | null;
};
export type CommandSpec = {
  name: string;
  description: Localized;
  args: ArgSpec[];
  input_map: Record<string, MapEntry>;
  output: OutputSpec;
  timeout_s: number;
};
export type AppSpec = { workflow: WorkflowSpec; command: CommandSpec | null };

const text = (name: string, description: string): WfInput => ({
  name,
  type: "text",
  required: true,
  description,
});
const arg = (name: string, vi: string, en: string, o: Partial<ArgSpec> = {}): ArgSpec => ({
  name,
  description: { vi, en },
  default: null,
  fallback: null,
  rest: false,
  ...o,
});
const md = (field: string): OutputSpec => ({ field, render: "markdown" });
const textArg = arg("text", "Nội dung (mặc định: đoạn đang chọn)", "Text (default: selection)", {
  rest: true,
  fallback: "selection",
});
const EMAIL_INPUTS = [
  text("subject", "Tiêu đề email"),
  text("sender", "Người gửi email"),
  text("email_body", "Nội dung email"),
];
const EMAIL_MAP: Record<string, MapEntry> = {
  email_body: { source: "arg", value: "text" },
  subject: { source: "const", value: "(không tiêu đề)" },
  sender: { source: "const", value: "(dán từ chat)" },
};

export const APPS: Record<SeedApp, AppSpec> = {
  // Hub `dify-agent` cần input nhận tin (`query`, R14 H2a) — `[]` làm `hub:seed` báo lỗi (quyết định S1, lệch §5.3).
  chatbot: {
    workflow: {
      key: "dify-chatbot",
      name: "Chatbot (Dify)",
      description:
        "App agent Dify trò chuyện với người dùng, dùng cho agent dify-chatbot của Hub (X1).",
      app_type: "agent",
      input_schema: [text("query", "Tin nhắn người dùng gửi cho chatbot")],
      output_field: null,
    },
    command: null,
  },
  translate: {
    workflow: {
      key: "dify-translate",
      name: "Dịch (Dify)",
      description: "Workflow Dify dịch văn bản sang ngôn ngữ đích, dùng cho lệnh /translate (X1).",
      app_type: "workflow",
      input_schema: [text("text", "Văn bản cần dịch"), text("target_lang", "Ngôn ngữ đích")],
      output_field: "text",
    },
    command: {
      name: "translate",
      description: { vi: "Dịch văn bản qua Dify", en: "Translate text via Dify" },
      args: [arg("lang", "Ngôn ngữ đích", "Target language", { default: "vi" }), textArg],
      input_map: {
        text: { source: "arg", value: "text" },
        target_lang: { source: "arg", value: "lang" },
      },
      output: md("text"),
      timeout_s: 60,
    },
  },
  "gmail-summary": {
    workflow: {
      key: "dify-gmail-summary",
      name: "Tóm tắt email (Dify)",
      description: "Workflow Dify tóm tắt nội dung email, dùng cho lệnh /summary (X1).",
      app_type: "workflow",
      input_schema: EMAIL_INPUTS,
      output_field: "summary",
    },
    command: {
      name: "summary",
      description: { vi: "Tóm tắt email qua Dify", en: "Summarize an email via Dify" },
      args: [textArg],
      input_map: EMAIL_MAP,
      output: md("summary"),
      timeout_s: 60,
    },
  },
  "email-reply": {
    workflow: {
      key: "dify-email-reply",
      name: "Trả lời email (Dify)",
      description: "Workflow Dify soạn thư trả lời cho một email, dùng cho lệnh /reply (X1).",
      app_type: "workflow",
      input_schema: EMAIL_INPUTS,
      output_field: "text",
    },
    command: {
      name: "reply",
      description: { vi: "Soạn trả lời email qua Dify", en: "Draft an email reply via Dify" },
      args: [textArg],
      input_map: EMAIL_MAP,
      output: md("text"),
      timeout_s: 60,
    },
  },
  "screenshot-ask": {
    workflow: {
      key: "dify-screenshot-ask",
      name: "Hỏi về ảnh (Dify)",
      description:
        "Workflow Dify trả lời câu hỏi về một ảnh đính kèm, dùng cho lệnh /ask-image (X1).",
      app_type: "workflow",
      input_schema: [
        { name: "image", type: "file", required: true, description: "Ảnh cần hỏi" },
        text("question", "Câu hỏi về ảnh"),
      ],
      output_field: "text",
    },
    command: {
      name: "ask-image",
      description: {
        vi: "Hỏi về ảnh đính kèm qua Dify",
        en: "Ask about an attached image via Dify",
      },
      args: [
        arg("question", "Câu hỏi về ảnh", "Question about the image", {
          rest: true,
          default: "Mô tả nội dung ảnh này",
        }),
      ],
      input_map: {
        image: { source: "attachment" },
        question: { source: "arg", value: "question" },
      },
      output: md("text"),
      timeout_s: 90,
    },
  },
};

/** Agent Hub cho app chatbot (K7: tạo bằng Hub seed overlay, không qua Studio). */
export const CHATBOT_AGENT = {
  key: "dify-chatbot",
  workflow_key: "dify-chatbot",
  name: { vi: "Chatbot (Dify)", en: "Chatbot (Dify)" },
  description: "Trò chuyện với chatbot Dify thật (app agent dify-chatbot) cho bản demo X1.",
} as const;
export const GROUP_MEMBERS = ["lan"] as const;
export const FEATURE = { key: "dify-demo", name: { vi: "Dify demo", en: "Dify demo" } } as const;
export const SECRET_NOTE = "seed:dify X1";
