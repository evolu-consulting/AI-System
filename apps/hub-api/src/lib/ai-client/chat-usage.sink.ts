// M3-decouple · usage của trợ lý chat (M2 `recordChatUsage`, Dify lẫn Claude) — MỘT nguồn: runtime agent đã ghi usage mỗi job vào
// `hub.usage_logs` trong cùng tx kết thúc job (trước khi Hub nhận `job.done`). Hub chỉ GẮN `feature='chat'` cho các dòng của run
// (`hub.tag_chat_usage`, SECURITY DEFINER) để dòng tính vào trần token/tenant/ngày của AI client — không chèn dòng thứ hai (trước
// đây đếm hai lần). Run không có dòng nào ⇒ cảnh báo (runtime không ghi usage), không tự chèn số ước lượng.
import { sql } from "drizzle-orm";
import type { Db } from "../db";
import { logger } from "../logger";

export const CHAT_FEATURE = "chat";

type ChatRow = { tenantId: string; runId: string };

export function chatUsageSink(db: Db) {
  return async (row: ChatRow): Promise<void> => {
    const [r] = await db.db.execute<{ n: number }>(
      sql`select hub.tag_chat_usage(${row.tenantId}::uuid, ${row.runId}::uuid) as n`,
    );
    if (Number(r?.n ?? 0) === 0)
      logger.warn("chat-usage-missing", { tenant_id: row.tenantId, run_id: row.runId });
  };
}
