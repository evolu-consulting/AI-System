// HUB-FR-89, HUB-FR-90 · H2a-R09–R11, R14, R15, R17, R20 · luật thuần client Dify (plan-rules, plan-errors §2).
// Bảng lỗi dùng chung với Runtime Python (RT3).
import type { WorkflowInput } from "@ai/contracts";
import type { DifyAppType } from "@ai/contracts/hub";
import type { WorkflowInputValue } from "../commands/catalog.types";

export type DifyRunBodyInput = {
  appType: DifyAppType;
  inputs: Record<string, WorkflowInputValue>;
  query: string | null;
  user: string;
  conversationId: string | null;
};

/** `usage` để thô — chuẩn hoá bằng `difyUsage`. `status` = `workflow_finished.data.status` (`message_end` → `succeeded`). */
export type DifyEvent =
  | { kind: "delta"; text: string }
  | { kind: "meta"; taskId?: string; conversationId?: string }
  | {
      kind: "finished";
      status: string;
      outputs: Record<string, unknown> | null;
      usage: unknown;
    }
  | { kind: "error"; message: string | null }
  | { kind: "ignore" };

export type DifyHttpErrorCode = "NOT_CONFIGURED" | "UPSTREAM_ERROR";
export type DifyUsage = { input_tokens: number; output_tokens: number; cost_usd: number };

export const DIFY_MASK = "***";
export const DIFY_UPSTREAM_DETAIL_MAX = 300;
export const DIFY_INPUT_LOG_MAX = 200;
/** `workflow_finished.data.status` coi là lỗi (HTTP 200 nhưng chạy hỏng — plan-errors §2). Trạng thái khác = xong. */
export const DIFY_FAILED_STATUSES: ReadonlySet<string> = new Set(["failed", "stopped"]);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;
const trimBase = (baseUrl: string): string => baseUrl.replace(/\/+$/, "");
const isChatApp = (t: DifyAppType): boolean => t !== "workflow";

export function difyRunUrl(appType: DifyAppType, baseUrl: string): string {
  return `${trimBase(baseUrl)}${isChatApp(appType) ? "/chat-messages" : "/workflows/run"}`;
}

export function difyStopUrl(appType: DifyAppType, baseUrl: string, taskId: string): string {
  const id = encodeURIComponent(taskId);
  return isChatApp(appType)
    ? `${trimBase(baseUrl)}/chat-messages/${id}/stop`
    : `${trimBase(baseUrl)}/workflows/tasks/${id}/stop`;
}

/** `response_mode:"streaming"`; `query` chỉ khi chat/agent; `conversation_id` khi có. */
export function difyRunBody(i: DifyRunBodyInput): Record<string, unknown> {
  const body: Obj = { inputs: i.inputs, response_mode: "streaming", user: i.user };
  if (isChatApp(i.appType)) {
    body.query = i.query ?? "";
    if (i.conversationId) body.conversation_id = i.conversationId;
  }
  return body;
}

function finishedOf(e: Obj): DifyEvent {
  if (e.event === "message_end") {
    const meta = isObj(e.metadata) ? e.metadata : {};
    return { kind: "finished", status: "succeeded", outputs: null, usage: meta.usage };
  }
  const data = isObj(e.data) ? e.data : {};
  const meta = isObj(data.metadata) && isObj(data.metadata.usage) ? data.metadata.usage : {};
  return {
    kind: "finished",
    status: typeof data.status === "string" ? data.status : "succeeded",
    outputs: isObj(data.outputs) ? data.outputs : null,
    usage: workflowUsage(data, meta),
  };
}

/**
 * R15 app `workflow`: `total_tokens` → `input_tokens`, `output_tokens = 0` (không lấy prompt/completion của
 * `metadata.usage`); giá `total_price`/`currency` lấy ở `data` hoặc `metadata.usage`.
 */
function workflowUsage(data: Obj, meta: Obj): Obj {
  const pick = (k: string) => (data[k] !== undefined ? data[k] : meta[k]);
  return {
    total_tokens: pick("total_tokens"),
    total_price: pick("total_price"),
    currency: pick("currency"),
  };
}

/** Sự kiện SSE Dify (đã JSON.parse) → nghĩa. Không đọc tên/tiêu đề node (R09). */
export function interpretDifyEvent(e: unknown): DifyEvent {
  if (!isObj(e)) return { kind: "ignore" };
  switch (e.event) {
    case "text_chunk": {
      const text = isObj(e.data) ? e.data.text : undefined;
      return typeof text === "string" ? { kind: "delta", text } : { kind: "ignore" };
    }
    case "message":
    case "agent_message":
      return typeof e.answer === "string" ? { kind: "delta", text: e.answer } : { kind: "ignore" };
    case "workflow_started": {
      const taskId = str(e.task_id);
      const conversationId = str(e.conversation_id);
      return {
        kind: "meta",
        ...(taskId ? { taskId } : {}),
        ...(conversationId ? { conversationId } : {}),
      };
    }
    case "workflow_finished":
    case "message_end":
      return finishedOf(e);
    case "error":
      return { kind: "error", message: typeof e.message === "string" ? e.message : null };
    default:
      return { kind: "ignore" };
  }
}

/** 401/403/404 → `NOT_CONFIGURED`; còn lại → `UPSTREAM_ERROR` (plan-errors §2). */
export function mapDifyHttpError(status: number): DifyHttpErrorCode {
  return status === 401 || status === 403 || status === 404 ? "NOT_CONFIGURED" : "UPSTREAM_ERROR";
}

/** Chunk đã gom thắng; không thì `outputs[field ?? "text"]` (object/số → JSON); rỗng → `null`. */
export function finalText(
  acc: string,
  outputs: Record<string, unknown> | null,
  field: string | null,
): string | null {
  if (acc.length > 0) return acc;
  const v = outputs?.[field ?? "text"];
  if (v === undefined || v === null) return null;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 0 ? s : null;
}

/** Số không âm hữu hạn từ số hoặc chuỗi số thập phân; khác → undefined. */
function num(v: unknown): number | undefined {
  const n =
    typeof v === "number"
      ? v
      : typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim())
        ? Number(v)
        : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** R15: chỉ `currency = USD` mới tính `cost_usd`; thiếu/rác → 0. */
export function difyUsage(u: unknown): DifyUsage {
  if (!isObj(u)) return { input_tokens: 0, output_tokens: 0, cost_usd: 0 };
  const prompt = num(u.prompt_tokens);
  const completion = num(u.completion_tokens);
  const detailed = prompt !== undefined || completion !== undefined;
  const input = detailed ? (prompt ?? 0) : (num(u.total_tokens) ?? 0);
  const output = detailed ? (completion ?? 0) : 0;
  const cost = u.currency === "USD" ? (num(u.total_price) ?? 0) : 0;
  return { input_tokens: Math.floor(input), output_tokens: Math.floor(output), cost_usd: cost };
}

/** Các dạng mã hoá của secret, dài trước (base64 có padding trước bản bỏ padding). */
function secretForms(secret: string): string[] {
  const b = Buffer.from(secret, "utf8");
  const b64 = b.toString("base64");
  const hex = b.toString("hex");
  const forms = [
    secret,
    b64,
    b64.replace(/=+$/, ""),
    b.toString("base64url"),
    hex,
    hex.toUpperCase(),
  ];
  return [...new Set(forms)].sort((x, y) => y.length - x.length);
}

/** Che `secret` (thô/base64/hex) → `***` **trước**, rồi cắt ≤ `max` (như `mask` Python, plan-runtime §3.1). */
export function maskSecret(text: string, secret: string, max = DIFY_UPSTREAM_DETAIL_MAX): string {
  let out = text;
  if (secret.length > 0) for (const f of secretForms(secret)) out = out.replaceAll(f, DIFY_MASK);
  return out.slice(0, Math.max(0, max));
}

/** R20: mỗi giá trị `maskSecret(String(v), secret)` rồi cắt ≤ 200. */
export function maskInputs(
  inputs: Record<string, unknown>,
  secret: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(inputs))
    out[k] = maskSecret(String(v), secret, DIFY_INPUT_LOG_MAX);
  return out;
}

/** R15: `"<tenant_key>:<user_id>"`. */
export function difyUser(tenantKey: string, userId: string): string {
  return `${tenantKey}:${userId}`;
}

/** R14: tên input nhận tin của agent `dify-*` — `query` nếu có; một input chuỗi bắt buộc duy nhất; không thì `null`. */
export function difyAgentInput(inputs: readonly WorkflowInput[]): string | null {
  if (inputs.some((i) => i.name === "query")) return "query";
  const required = inputs.filter((i) => i.required);
  const only = required.length === 1 ? required[0] : undefined;
  return only?.type === "text" ? only.name : null;
}
