// HUB-FR-80 · H2a-R15 · P2 · ghi một dòng `usage_logs` billing `dify` cho mỗi lời gọi Dify của Hub qua hàm
// `hub.log_dify_usage` (SECURITY DEFINER, EXECUTE `hub_rw` — `hub_api` không INSERT `usage_logs`, khoá H1 A51).
// Hàm cố định `billing='dify'`, `provider_key='dify'`, `model=NULL`. Gọi trong transaction của người gọi hoặc thẳng `db`.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { Db } from "../../lib/db";
import type { DifyUsage } from "./dify.rules";

export type DifyUsageRow = {
  tenantId: string;
  runId: string;
  stepId: string;
  userId: string;
  /** Run command → feature của lệnh; tool/agent `dify-*` → null (R15). */
  featureId: string | null;
  /** Agent `dify-*`/agent gọi tool MCP; command → null. */
  agentId: string | null;
  usage: DifyUsage;
  latencyMs: number;
};

const INT_MAX = 2_147_483_647;
const int = (n: number): number => Math.min(INT_MAX, Math.max(0, Math.floor(Number(n) || 0)));
/** `numeric` dạng chuỗi (không qua float của driver); âm/NaN → 0. */
const money = (n: number): string => (Number.isFinite(n) && n > 0 ? String(n) : "0");

/** `select hub.log_dify_usage(...)` — `exec` là transaction đang mở (`Tx`) hoặc `db.db`. */
export async function logDifyUsage(exec: Pick<Tx, "execute">, r: DifyUsageRow): Promise<void> {
  await exec.execute(sql`select hub.log_dify_usage(${r.tenantId}::uuid, ${r.runId}::uuid,
    ${r.stepId}::uuid, ${r.userId}::uuid, ${r.featureId}::uuid, ${r.agentId}::uuid,
    ${int(r.usage.input_tokens)}::int, ${int(r.usage.output_tokens)}::int,
    ${money(r.usage.cost_usd)}::numeric, ${int(r.latencyMs)}::int)`);
}

/** Ghi ngoài transaction (vd sau khi stream Dify kết thúc). */
export function recordDifyUsage(db: Db, r: DifyUsageRow): Promise<void> {
  return logDifyUsage(db.db, r);
}
