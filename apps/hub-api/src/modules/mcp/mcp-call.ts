// HUB-FR-50 · H2a-R20, R22 · tách khỏi `mcp.service.ts` (trần 400 dòng, K1 plan §9): mã bước `tool` từ kết quả Dify + cổng
// `side_effect` mặc định (từ chối khi không nối `confirmationGate`).
import type { Logger } from "../../lib/logger";
import type { DifyRunOutcome } from "../dify/dify.client";
import { type ToolErrorCode, toolError } from "./mcp.rules";
import type { SideEffectGate } from "./mcp.service";

/** Mã trong `detail` bước `tool`: mã tool, hoặc `CANCELLED` (kết nối `/mcp` đóng) / `INTERNAL_ERROR` (ngoại lệ). */
export type StepCode = ToolErrorCode | "CANCELLED" | "INTERNAL_ERROR";

/** Kết quả Dify → mã bước (plan-errors §4); xong → null. Huỷ do hết hạn tool → `TIMEOUT`; do kết nối đóng → `CANCELLED`. */
export function stepCodeOf(out: DifyRunOutcome, timedOut: boolean): StepCode | null {
  if (out.kind === "finished") return null;
  if (out.kind === "aborted") return timedOut ? "TIMEOUT" : "CANCELLED";
  return out.code;
}

/** Mặc định khi không nối cổng: tool `side_effect` không chạy (không có xác nhận ⇒ không gọi Dify). */
export function refuseSideEffect(log: Logger): SideEffectGate {
  return async (ctx, wf) => {
    log.warn("tool-side-effect-unconfirmed", { run_id: ctx.runId, workflow_id: wf.id });
    return toolError("NOT_CONFIGURED");
  };
}
