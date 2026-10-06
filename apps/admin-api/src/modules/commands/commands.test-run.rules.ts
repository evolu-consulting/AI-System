// ADM-FR-23 · luật thuần "Chạy thử" (plan X1 §2.2): kiểm trước khi gọi Hub (bước 3–6) và ánh xạ phản hồi Hub (8a–8f).
// Không I/O. Không bao giờ chép message/details của Hub ở nhánh 401/5xx/mạng (có thể chứa header/token).
import {
  type COMMAND_TEST_ERRORS,
  CommandTestResponseSchema,
  type ErrorResponse,
  ErrorResponseSchema,
} from "@ai/contracts";

export type PrecheckInput = {
  hubConfigured: boolean;
  workflow: { id: string; sideEffect: boolean } | null;
  workflowId: string;
  confirm: boolean | undefined;
  runAs: { requested?: string; exists: boolean };
};
export type PrecheckCode =
  | "HUB_NOT_CONFIGURED"
  | "INVALID_REFERENCE"
  | "SIDE_EFFECT_CONFIRM_REQUIRED";
export type PrecheckResult = { ok: true } | { ok: false; code: PrecheckCode; details?: unknown };

/** Dừng ở điều kiện trượt đầu tiên: Hub cấu hình → workflow có → xác nhận side_effect → run_as có. */
export function testRunPrecheck(i: PrecheckInput): PrecheckResult {
  if (!i.hubConfigured) return { ok: false, code: "HUB_NOT_CONFIGURED" };
  if (!i.workflow) {
    return {
      ok: false,
      code: "INVALID_REFERENCE",
      details: { field: "workflow_id", ids: [i.workflowId] },
    };
  }
  if (i.workflow.sideEffect && i.confirm !== true) {
    return {
      ok: false,
      code: "SIDE_EFFECT_CONFIRM_REQUIRED",
      details: { workflow_id: i.workflow.id },
    };
  }
  if (i.runAs.requested !== undefined && !i.runAs.exists) {
    return {
      ok: false,
      code: "INVALID_REFERENCE",
      details: { field: "run_as_user_id", ids: [i.runAs.requested] },
    };
  }
  return { ok: true };
}

/** Message tiếng Anh cố định; web dịch theo `code`. */
export const COMMAND_TEST_MESSAGES = {
  CMD_MISSING_ARG: "Missing or invalid command arguments",
  NOT_CONFIGURED: "Workflow is not configured",
  SIDE_EFFECT_CONFIRM_REQUIRED: "This workflow has side effects; confirm to run it",
  HUB_UNAVAILABLE: "Hub is unavailable",
  HUB_NOT_CONFIGURED: "Hub connection is not configured",
} as const satisfies Record<keyof typeof COMMAND_TEST_ERRORS, string>;

export type HubMapped = { status: number; body: unknown };

const err = (status: number, code: string, message: string, details?: unknown): HubMapped => {
  const e: ErrorResponse["error"] = { code, message };
  if (details !== undefined) e.details = details;
  return { status, body: { error: e } };
};
const unavailable = (): HubMapped =>
  err(502, "HUB_UNAVAILABLE", COMMAND_TEST_MESSAGES.HUB_UNAVAILABLE);

/** Hub chỉ biết `actor_user_id`; phía Admin trường đó là `run_as_user_id`. */
const renameActor = (details: unknown): unknown =>
  details === undefined
    ? undefined
    : JSON.parse(JSON.stringify(details).replaceAll("actor_user_id", "run_as_user_id"));

/** Lỗi Hub có mã mong đợi (8c/8d) → chuyển tiếp cùng status; mã khác ⇒ Hub lệch giao thức ⇒ 502. */
function forwardKnown(status: number, body: unknown): HubMapped {
  const p = ErrorResponseSchema.safeParse(body);
  if (!p.success) return unavailable();
  const { code, details } = p.data.error;
  if (status === 400 && code === "VALIDATION_ERROR") {
    return err(400, code, "Invalid request", renameActor(details));
  }
  if (status === 422 && code === "CMD_MISSING_ARG") {
    return err(422, code, COMMAND_TEST_MESSAGES.CMD_MISSING_ARG, details);
  }
  if (status === 409 && code === "NOT_CONFIGURED") {
    return err(409, code, COMMAND_TEST_MESSAGES.NOT_CONFIGURED, details);
  }
  return unavailable();
}

/** Bảng 8a–8f. `body` = JSON Hub đã parse (hoặc `undefined` khi không đọc được). */
export function mapHubTestRun(status: number | "network" | "timeout", body: unknown): HubMapped {
  if (typeof status !== "number") return unavailable();
  if (status === 200) {
    const r = CommandTestResponseSchema.safeParse(body);
    return r.success ? { status: 200, body: r.data } : unavailable();
  }
  if (status === 401 || status === 503) {
    return err(503, "HUB_NOT_CONFIGURED", COMMAND_TEST_MESSAGES.HUB_NOT_CONFIGURED);
  }
  if (status === 400 || status === 409 || status === 422) return forwardKnown(status, body);
  return unavailable();
}
