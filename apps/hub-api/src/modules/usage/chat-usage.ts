// M2-chat · usage LLM của chat (Dify hoặc Claude) theo tenant — MỘT hàm ghi. Bảng usage dùng chung do lát M3 thêm; tới khi có,
// `sink` mặc định chỉ log một dòng có cấu trúc (không nội dung). M3 gọi `setChatUsageSink` trỏ vào bảng. Không bao giờ ném,
// không chặn run (ghi lỗi ⇒ cảnh báo). Gọi từ `runJob` (đường chung của mọi agent: `agentic-cli` lẫn `dify-*`).
import type { TokenUsage } from "@ai/contracts/hub";
import { logger } from "../../lib/logger";

export type ChatUsageRow = {
  tenantId: string;
  userId: string;
  runId: string;
  agentId: string;
  agentKey: string;
  /** Runtime agent: `agentic-cli` (Claude/CLI) | `dify-agent` | `dify-workflow` | … */
  runtime: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  ok: boolean;
};
export type ChatUsageSink = (row: ChatUsageRow) => void | Promise<void>;

const logSink: ChatUsageSink = (row) => logger.info("chat-usage", { ...row });
let sink: ChatUsageSink = logSink;

/** M3 · trỏ vào bảng usage dùng chung (test đặt sink giả); `null` ⇒ về log. */
export function setChatUsageSink(s: ChatUsageSink | null): void {
  sink = s ?? logSink;
}

let inflight: Promise<void> = Promise.resolve();
/** M3 · tín hiệu: mọi lần ghi usage chat đã gửi tới lúc gọi đã xong (test chờ, không poll). */
export const chatUsageSettled = (): Promise<void> => inflight;

export function recordChatUsage(row: ChatUsageRow): void {
  try {
    const p = Promise.resolve(sink(row)).catch((err: unknown) =>
      logger.warn("chat-usage-failed", { run_id: row.runId, error_name: (err as Error)?.name }),
    );
    inflight = Promise.all([inflight, p]).then(() => undefined);
  } catch (err) {
    logger.warn("chat-usage-failed", { run_id: row.runId, error_name: (err as Error)?.name });
  }
}

type TaskLike = {
  run: { id: string; tenantId: string; userId: string };
  agent: { id: string; key: string; runtime: string };
  stageRunId?: string | null;
};

/** Usage một bước agent của chat (bỏ job stage quy trình — không phải chat). */
export function noteChatUsage(task: TaskLike, usage: TokenUsage | undefined, ok: boolean): void {
  if (task.stageRunId || !usage) return;
  recordChatUsage({
    tenantId: task.run.tenantId,
    userId: task.run.userId,
    runId: task.run.id,
    agentId: task.agent.id,
    agentKey: task.agent.key,
    runtime: task.agent.runtime,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    costUsd: (usage as { cost_usd?: number }).cost_usd ?? null,
    ok,
  });
}
