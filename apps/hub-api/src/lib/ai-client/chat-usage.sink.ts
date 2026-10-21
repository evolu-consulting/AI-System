// M3-decouple · usage của trợ lý chat (M2 `recordChatUsage`, Dify lẫn Claude) — MỘT nguồn: runtime agent đã ghi usage mỗi job vào
// `hub.usage_logs` trong cùng tx kết thúc job (trước khi Hub nhận `job.done`). Hub chỉ GẮN nhãn cho các dòng của run — không
// chèn dòng thứ hai. usage-analytics (hub 0049, `hub.tag_run_usage`): `feature='chat'` (trừ run quy trình — giữ trần token như
// cũ), `app` (process | rooms | bề mặt gửi tin | chat) và `outcome` (ok | error). Run không có dòng nào ⇒ cảnh báo.
import { sql } from "drizzle-orm";
import type { Db } from "../db";
import { logger } from "../logger";

export const CHAT_FEATURE = "chat";

type ChatRow = { tenantId: string; runId: string; ok: boolean; stage?: boolean };

export function chatUsageSink(db: Db) {
  return async (row: ChatRow): Promise<void> => {
    const [r] = await db.db.execute<{ n: number }>(
      sql`select hub.tag_run_usage(${row.tenantId}::uuid, ${row.runId}::uuid, ${row.stage === true},
        ${row.ok}) as n`,
    );
    if (Number(r?.n ?? 0) === 0)
      logger.warn("chat-usage-missing", { tenant_id: row.tenantId, run_id: row.runId });
  };
}
