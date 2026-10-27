// engine-flag-tenant · env CONTRACTS_APPROVAL_ENGINE=on + cổng theo công ty: tenant KHÔNG có entitlement `contracts-approval-engine`
// ⇒ lượt level1 chạy máy 2 bước cũ; có entitlement còn hiệu lực ⇒ chạy engine; thu hồi ⇒ HĐ mới lại về máy cũ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { seedContract, toLevel1 } from "../HD3/_hd3";
import { bumpConfig } from "../N1/_support/n1";
import { type Json, T } from "../P-d/_support/pd";
import { type CtxCf, startCf } from "./_cf";

let c: CtxCf;
beforeAll(async () => {
  c = await startCf({}, { contractsAi: { approvalEngineTenantGate: true } });
}, 180_000);
afterAll(async () => {
  await c?.stop();
});

const modeOf = async (aid: string): Promise<unknown> =>
  ((await c.sql<Json[]>`select mode from contracts.approvals where id = ${aid}`)[0] as Json).mode;

describe("engine-flag-tenant · cổng theo công ty", () => {
  it("chưa có feature/entitlement ⇒ máy cũ; cấp ⇒ engine; thu hồi ⇒ máy cũ", async () => {
    const a = await toLevel1(c, await seedContract(c, 721), 10_000_000);
    expect(await modeOf(a.runId)).toBe("machine");

    await c.sql`insert into admin.features (key, name, description, icon, status)
      values ('contracts-approval-engine', '{"vi":"x"}'::jsonb, '{"vi":"x"}'::jsonb, 'workflow', 'on')
      on conflict (key) do nothing`;
    await c.sql`insert into admin.feature_entitlements (feature_id, tenant_id)
      select id, ${T.acme} from admin.features where key = 'contracts-approval-engine'
      on conflict (feature_id, tenant_id) do update set revoked_at = null`;
    await bumpConfig(c.sql, T.acme);
    const b = await toLevel1(c, await seedContract(c, 722), 10_000_000);
    expect(await modeOf(b.runId)).toBe("engine");

    await c.sql`update admin.feature_entitlements set revoked_at = now()
      where tenant_id = ${T.acme}
        and feature_id = (select id from admin.features where key = 'contracts-approval-engine')`;
    await bumpConfig(c.sql, T.acme);
    const d = await toLevel1(c, await seedContract(c, 723), 10_000_000);
    expect(await modeOf(d.runId)).toBe("machine");
    // Lượt đã chạy engine không bị cắt giữa chừng.
    expect(await modeOf(b.runId)).toBe("engine");
  }, 90_000);
});
