// ADM-NFR-06 · body cố định của mock (spec M0 §3.2, §3.3, §3.4) để test so khớp tuyệt đối.

export const NOT_FOUND_BODY = { error: { code: "NOT_FOUND", message: "Not found" } } as const;

// --- Dify (Service API, blocking) ---
export const DIFY_TOKENS = {
  ok: "app-mock-ok",
  unauthorized: "app-mock-401",
  timeout: "app-mock-timeout",
} as const;

export const DIFY_UNAUTHORIZED = {
  code: "unauthorized",
  message: "Access token is invalid",
  status: 401,
} as const;

export const difyInvalidParam = (message: string) => ({
  code: "invalid_param",
  message,
  status: 400,
});

export const DIFY_WORKFLOW_RUN_OK = (inputs: unknown) => ({
  workflow_run_id: "mock-wfr-0001",
  task_id: "mock-task-0001",
  data: {
    id: "mock-wfr-0001",
    workflow_id: "mock-wf-0001",
    status: "succeeded",
    outputs: { text: `mock:${JSON.stringify(inputs)}` },
    error: null,
    elapsed_time: 0.12,
    total_tokens: 42,
    total_steps: 3,
    created_at: 1767225600,
    finished_at: 1767225601,
  },
});

export const DIFY_CHAT_OK = (query: string) => ({
  event: "message",
  message_id: "mock-msg-0001",
  conversation_id: "mock-conv-0001",
  mode: "chat",
  answer: `mock answer: ${query}`,
  metadata: {
    usage: {
      prompt_tokens: 30,
      completion_tokens: 12,
      total_tokens: 42,
      total_price: "0.000100",
      currency: "USD",
      latency: 0.12,
    },
  },
  created_at: 1767225600,
});

export const DIFY_PARAMETERS = {
  user_input_form: [
    {
      "text-input": {
        label: "text",
        variable: "text",
        required: true,
        max_length: 256,
        default: "",
      },
    },
    {
      select: {
        label: "lang",
        variable: "lang",
        required: true,
        options: ["vi", "en"],
        default: "vi",
      },
    },
  ],
  system_parameters: {},
};

// --- Agent Hub (ba-agent-hub.md §9.1; test-run là hình tạm tới spec M2 / HUB-FR-51) ---
export const HUB_TOKENS = {
  ok: "mock-ok",
  unauthorized: "mock-401",
  timeout: "mock-timeout",
} as const;

export const HUB_UNAUTHORIZED = {
  error: { code: "UNAUTHORIZED", message: "Invalid token" },
} as const;

export const hubValidationFailed = (message: string) => ({
  error: { code: "VALIDATION_FAILED", message },
});

export const HUB_HEALTH = { status: "ok", version: "mock" } as const;

export const HUB_TEST_RUN_OK = (inputs: unknown) => ({
  run_id: "00000000-0000-7000-8000-000000000001",
  status: "succeeded",
  output: { text: `mock:${JSON.stringify(inputs)}` },
  ms: 120,
  trace: [],
});

export const HUB_EFFECTIVE_OK = {
  items: [
    {
      agent_id: "00000000-0000-7000-8000-0000000000a1",
      key: "invoice-checker",
      name: { vi: "Kiểm tra hoá đơn", en: "Invoice checker" },
      reasons: ["group:mock-group"],
    },
  ],
};
