// M3-decouple · bảng usage CHUNG của AI client = `hub.usage_logs` (billing `api`, cột `feature`) qua hàm SECURITY DEFINER
// `hub.log_ai_usage` / `hub.ai_tokens_since` (migration hub 0042) + giữ chỗ `hub.ai_reserve_tokens` / `hub.ai_release_tokens`
// (hub 0043, M3c) — `hub_api` không INSERT/SELECT trực tiếp. Mỗi hàm MỘT câu.
// `recordAiUsage` là hàm ghi dùng chung (trợ lý chat M2 trỏ vào đây).
import { sql } from "drizzle-orm";
import type { Db } from "../db";
import type { UsageRecord, UsageStore } from "./ai-client";

const INT_MAX = 2_147_483_647;
const int = (n: number): number => Math.min(INT_MAX, Math.max(0, Math.floor(Number(n) || 0)));

/** Ghi một dòng usage (tenant, người, tính năng, model, token, chi phí). */
export async function recordAiUsage(db: Db, r: UsageRecord): Promise<void> {
  const cost = r.costUsd === null || !Number.isFinite(r.costUsd) ? null : String(r.costUsd);
  // ai-sub · `billing` theo nhà cung cấp (`api` | `subscription`, hub 0044)
  await db.db.execute(sql`select hub.log_ai_usage_billed(${r.tenantId}::uuid, ${r.userId}::uuid, ${r.feature},
    ${r.providerKey}, ${r.model}, ${int(r.usage.inputTokens)}::int, ${int(r.usage.outputTokens)}::int,
    ${int(r.usage.cacheReadTokens)}::int, ${int(r.usage.cacheWriteTokens)}::int, ${cost}::numeric,
    ${int(r.latencyMs)}::int, ${r.billing ?? "api"})`);
}

export function pgUsageStore(db: Db): UsageStore {
  return {
    record: (r) => recordAiUsage(db, r),
    async tokensSince(tenantId, since) {
      const [row] = await db.db.execute<{ n: string | number }>(
        sql`select hub.ai_tokens_since(${tenantId}::uuid, ${since.toISOString()}::timestamptz) as n`,
      );
      return Number(row?.n ?? 0);
    },
    // M3c (review B #13) · giữ chỗ nguyên tử: MỘT câu (hàm khoá advisory theo tenant trong tx của câu).
    async reserve(r) {
      const [row] = await db.db.execute<{ hold_id: string; max_output: number }>(
        sql`select hold_id, max_output from hub.ai_reserve_tokens(${r.tenantId}::uuid,
          ${r.since.toISOString()}::timestamptz, ${Math.max(0, Math.floor(r.cap))}::bigint, ${int(r.inputTokens)}::int,
          ${int(r.maxOutput)}::int, ${int(r.minOutput)}::int, ${int(r.ttlS)}::int)`,
      );
      return row ? { holdId: row.hold_id, maxOutput: Number(row.max_output) } : null;
    },
    async release(holdId, tenantId) {
      // TD #241 · hub 0045: hàm nhận thêm tenant (id + tenant cùng khớp mới xoá)
      await db.db.execute(sql`select hub.ai_release_tokens(${holdId}::uuid, ${tenantId}::uuid)`);
    },
  };
}
