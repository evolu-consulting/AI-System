// M3-decouple · usage của trợ lý chat (M2: `recordChatUsage`, cả Dify lẫn Claude) ghi vào bảng usage CHUNG của AI client
// (`hub.usage_logs`, feature `chat`, provider = runtime agent). Dòng `feature IS NOT NULL` tính vào trần token/tenant/ngày.
import type { Db } from "../db";
import { recordAiUsage } from "./usage.pg";

export const CHAT_FEATURE = "chat";

type ChatRow = {
  tenantId: string;
  userId: string;
  runtime: string;
  agentKey: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
};

export function chatUsageSink(db: Db) {
  return (row: ChatRow): Promise<void> => {
    const usage = {
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    return recordAiUsage(db, {
      tenantId: row.tenantId,
      userId: row.userId,
      feature: CHAT_FEATURE,
      providerKey: row.runtime,
      model: row.agentKey,
      usage,
      costUsd: row.costUsd,
      latencyMs: 0,
    });
  };
}
