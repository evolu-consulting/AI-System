// HUB-FR-89, HUB-FR-90 · H2a-R09–R11, R14, R15, R17, R20 · luật thuần client Dify (plan-rules, plan-errors §2).
// Bảng lỗi dùng chung với Runtime Python (RT3). B0: chỉ chữ ký (B4).
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

export function difyRunUrl(appType: DifyAppType, baseUrl: string): string {
  throw new Error(`not implemented: difyRunUrl(${appType}, ${baseUrl.length})`);
}

export function difyStopUrl(appType: DifyAppType, baseUrl: string, taskId: string): string {
  throw new Error(`not implemented: difyStopUrl(${appType}, ${baseUrl.length}, ${taskId.length})`);
}

/** `response_mode:"streaming"`; `query` chỉ khi chat/agent; `conversation_id` khi có. */
export function difyRunBody(i: DifyRunBodyInput): Record<string, unknown> {
  throw new Error(`not implemented: difyRunBody(${i.appType})`);
}

export function interpretDifyEvent(e: unknown): DifyEvent {
  throw new Error(`not implemented: interpretDifyEvent(${typeof e})`);
}

/** 401/403/404 → `NOT_CONFIGURED`; còn lại → `UPSTREAM_ERROR` (plan-errors §2). */
export function mapDifyHttpError(status: number): DifyHttpErrorCode {
  throw new Error(`not implemented: mapDifyHttpError(${status})`);
}

/** Chunk đã gom thắng; không thì `outputs[field ?? "text"]` (object/số → JSON); rỗng → `null`. */
export function finalText(
  acc: string,
  outputs: Record<string, unknown> | null,
  field: string | null,
): string | null {
  throw new Error(`not implemented: finalText(${acc.length}, ${outputs === null}, ${field})`);
}

/** R15: chỉ `currency = USD` mới tính `cost_usd`; thiếu/rác → 0. */
export function difyUsage(u: unknown): DifyUsage {
  throw new Error(`not implemented: difyUsage(${typeof u})`);
}

/** Che `secret` (thô/base64/hex) → `***` **trước**, rồi cắt ≤ `max` (như `mask` Python, plan-runtime §3.1). */
export function maskSecret(text: string, secret: string, max = DIFY_UPSTREAM_DETAIL_MAX): string {
  throw new Error(`not implemented: maskSecret(${text.length}, ${secret.length}, ${max})`);
}

/** R20: mỗi giá trị `maskSecret(String(v), secret)` rồi cắt ≤ 200. */
export function maskInputs(
  inputs: Record<string, unknown>,
  secret: string,
): Record<string, string> {
  throw new Error(`not implemented: maskInputs(${Object.keys(inputs).length}, ${secret.length})`);
}

/** R15: `"<tenant_key>:<user_id>"`. */
export function difyUser(tenantKey: string, userId: string): string {
  throw new Error(`not implemented: difyUser(${tenantKey.length}, ${userId.length})`);
}

/** R14: tên input nhận tin của agent `dify-*` — `query` nếu có; một input chuỗi bắt buộc duy nhất; không thì `null`. */
export function difyAgentInput(inputs: readonly WorkflowInput[]): string | null {
  throw new Error(`not implemented: difyAgentInput(${inputs.length})`);
}
