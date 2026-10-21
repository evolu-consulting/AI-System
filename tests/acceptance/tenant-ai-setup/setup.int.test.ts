// tenant-ai-setup: tenant mới ⇒ assistant được cấp cho các Group có quyền contracts, gói knowledge được bật + cấp, agent mặc định
// đặt; chạy lại = no-op; tenant khác không bị đụng.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { run } from "../../../tools/scripts/src/tenant-ai-setup";
import { type World, world } from "../V2-B/_support/v2b";

let w: World;
beforeAll(async () => {
  w = await world({ ns: 2703 });
  await w.sql`update admin.tenants set key = 'nitigroup' where id = ${w.A}`;
  await w.sql`update admin.tenants set key = 'other' where id = ${w.B}`;
  const [p] = await w.sql<{ id: string }[]>`insert into hub.model_profiles (key, steps)
    values ('tas-test', '[{"model":"x"}]'::jsonb) returning id`;
  for (const k of ["assistant", "orchestrator"])
    await w.sql`insert into hub.agents (key, name, description, runtime, profile_id)
      values (${k}, ${w.sql.json({ vi: k })}, 'agent kiểm thử tenant-ai-setup', 'llm', ${p?.id as string})`;
  // Tenant A đã bật knowledge? Không — mô phỏng tenant mới chỉ có gói contracts.
  await w.sql`delete from admin.feature_entitlements e using admin.features f
    where f.id = e.feature_id and f.key like 'knowledge-%'`;
}, 180_000);
afterAll(async () => {
  await w?.stop();
});

const snap = (t: string) =>
  w.sql`select
    (select count(*)::int from hub.agent_grants where tenant_id = ${t}) as ag,
    (select count(*)::int from hub.agent_entitlements where tenant_id = ${t}) as ae,
    (select count(*)::int from admin.feature_entitlements e join admin.features f on f.id = e.feature_id
      where e.tenant_id = ${t} and f.key like 'knowledge-%' and e.revoked_at is null) as ke,
    (select count(*)::int from admin.feature_grants g join admin.features f on f.id = g.feature_id
      where g.tenant_id = ${t} and f.key like 'knowledge-%') as kg,
    (select a.key from hub.tenant_agent_defaults d join hub.agents a on a.id = d.default_agent_id
      where d.tenant_id = ${t}) as def`;

describe("tenant-ai-setup", () => {
  it("dry-run không ghi; --apply cấp đủ; chạy lại no-op; tenant khác không đổi", async () => {
    const dry = await run(w.sql, "nitigroup", false);
    expect(dry).toMatchObject({ entitlement: true, defaultAgent: true, knowledgePack: 3 });
    expect(dry.agentGrants).toBe(3);
    expect((await snap(w.A))[0]).toMatchObject({ ag: 0, ae: 0, ke: 0, kg: 0, def: null });

    await run(w.sql, "nitigroup", true);
    const after = (await snap(w.A))[0];
    expect(after).toEqual({ ag: 3, ae: 1, ke: 3, kg: 6, def: "assistant" });
    const [od] = await w.sql<
      { on_no_match: string }[]
    >`select on_no_match from hub.tenant_agent_defaults where tenant_id = ${w.A}`;
    expect(od?.on_no_match).toBe("answer");

    const again = await run(w.sql, "nitigroup", true);
    expect(again).toMatchObject({
      entitlement: false,
      agentGrants: 0,
      knowledgePack: 0,
      knowledgeGrants: 0,
      defaultAgent: false,
    });
    expect((await snap(w.A))[0]).toEqual(after);
    expect((await snap(w.B))[0]).toMatchObject({ ag: 0, ae: 0, ke: 0, kg: 0, def: null });
  });
});
