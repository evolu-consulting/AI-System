// HUB-FR-50 · H2a-R20 · tách khỏi `mcp.service.ts` (trần 400 dòng, K1 plan §9): mã bước `tool` từ kết quả Dify (dùng ở
// `adapters/workflow-invoker.ts`). Cổng `side_effect` mặc định `refuseSideEffect` về `mcp.service.ts` (T18s, gỡ vòng import).
import type { DifyRunOutcome } from "../dify/dify.client";
import type { ToolErrorCode } from "./mcp.rules";

/** Mã trong `detail` bước `tool`: mã tool, hoặc `CANCELLED` (kết nối `/mcp` đóng) / `INTERNAL_ERROR` (ngoại lệ). */
export type StepCode = ToolErrorCode | "CANCELLED" | "INTERNAL_ERROR";

/** Kết quả Dify → mã bước (plan-errors §4); xong → null. Huỷ do hết hạn tool → `TIMEOUT`; do kết nối đóng → `CANCELLED`. */
export function stepCodeOf(out: DifyRunOutcome, timedOut: boolean): StepCode | null {
  if (out.kind === "finished") return null;
  if (out.kind === "aborted") return timedOut ? "TIMEOUT" : "CANCELLED";
  return out.code;
}
