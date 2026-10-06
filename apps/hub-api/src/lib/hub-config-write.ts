// HUB-FR-78 · H3b-R06–R08 · PL3 · ghi cấu hình Hub từ API (plan H3b §5.1, plan-db §2 LOCK_META/BUMP_META/NOTIFY):
// khoá `config_meta` FOR UPDATE ĐẦU TIÊN (cùng chiều `hub:seed` ⇒ không deadlock) → tăng `hub_config_version` →
// `pg_notify('hub_config_changed')` trong transaction (chỉ giao khi COMMIT; rollback/retry 40P01 không gửi — Q-K7).
// Cùng hai câu bump/NOTIFY với `modules/seed/seed.repo.ts` (postgres.js thô, CLI) — TECH-DEBT 73 (K13).

import { HUB_CONFIG_CHANNEL, HUB_CONTRACT_VERSION } from "@ai/contracts/hub";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

const MISSING_META = "hub.config_meta thiếu hàng id=1 — chạy migrate Hub trước";

async function oneVersion(tx: Tx, query: ReturnType<typeof sql>): Promise<number> {
  const [r] = await tx.execute<{ v: number }>(query);
  if (!r) throw new Error(MISSING_META);
  return Number(r.v);
}

/** Khoá hàng `config_meta` (tuần tự hoá mọi ghi cấu hình Hub) và trả version hiện tại. Gọi trước mọi ghi khác. */
export function lockHubConfig(tx: Tx): Promise<number> {
  return oneVersion(
    tx,
    sql`select hub_config_version as v from hub.config_meta where id = 1 for update`,
  );
}

/** Tăng version (chỉ khi thật có đổi) và trả version mới. */
export function bumpHubConfig(tx: Tx): Promise<number> {
  return oneVersion(
    tx,
    sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1
      returning hub_config_version as v`,
  );
}

/** Payload y hệt `seed.repo.ts` `notifyHubConfigChanged` (`HubConfigChangedPayloadSchema`). */
export const hubConfigPayload = (version: number): string =>
  JSON.stringify({ v: HUB_CONTRACT_VERSION, version });

/** NOTIFY trong transaction: Postgres chỉ giao khi commit — lỗi/rollback thì không ai nhận. */
export async function notifyHubConfig(tx: Tx, version: number): Promise<void> {
  await tx.execute(sql`select pg_notify(${HUB_CONFIG_CHANNEL}, ${hubConfigPayload(version)})`);
}
