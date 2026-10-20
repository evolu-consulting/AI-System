// PK-FR-05 · UAT CR-095 B4: bật gói cho tenant ⇒ trợ lý AI của gói (`packs.pack_agents`) được entitlement + grant cho 3 Group
// vai NGAY trong tx bật gói (không phụ thuộc `hub:seed`). Tenant khác không nhận gì. Agent tạo SAU khi bật gói ⇒
// `packs.grant_agents(k, null, null)` (seed gọi) bù cho mọi tenant đã bật. Kiểm qua `GET /agent-grants/effective/:user_id`
// (cùng điều kiện menu `/agents`, R12). Không sleep: chờ tín hiệu nạp cache (`untilHubSettles`).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { insertHubConfig, PROFILE } from "../H1/_hub";
import {
  type CtxN1,
  call,
  needPackKit,
  P,
  PK,
  packGroupKey,
  startN1,
  T,
  untilHubSettles,
} from "./_support/n1";

const AGENT = { id: "a5e1a000-0000-4000-8000-000000000001", key: "pkdemo-assistant" };
const LATE = { id: "a5e1a000-0000-4000-8000-000000000002", key: "pkdemo-late" };
const DELTA = "a5e1a000-0000-4000-8000-0000000000d1";
const OWNER = {
  id: "a5e1a000-0000-4000-8000-0000000000d2",
  tid: DELTA,
  username: "delta-owner",
  display_name: "Chủ Delta",
  role: "member",
  locale: "vi",
  active: true,
  locked: false,
} as unknown as (typeof P)["lan"];

let c: CtxN1;
const insertAgent = (a: { id: string; key: string }) =>
  c.sql`insert into hub.agents (id, key, name, description, runtime, profile_id)
    values (${a.id}, ${a.key}, ${c.sql.json({ vi: a.key, en: a.key })},
      'Trợ lý của gói kiểm thử pkdemo cho người dùng.', 'agentic-cli', ${PROFILE.fake})`;

beforeAll(async () => {
  c = await startN1();
  await insertHubConfig(c.sql);
  await insertAgent(AGENT);
  await c.sql`insert into packs.pack_agents (pack_key, agent_key) values (${PK}, ${AGENT.key}), (${PK}, ${LATE.key})`;
  await c.sql`insert into admin.tenants (id, key, name, active) values (${DELTA}, 'delta', 'Delta Mới', true)`;
  await c.sql`insert into admin.users (id, tenant_id, username, email, password_hash, display_name, role, locale,
      active, locked_by_tenant, must_change_password)
    values (${OWNER.id}, ${DELTA}, 'delta-owner', 'delta-owner@example.test', 'x', 'Chủ Delta', 'member', 'vi',
      true, false, false)`;
});
afterAll(async () => {
  await c?.stop();
});

type Eff = { agents: { agent: { key: string }; visible: boolean }[] };
const effective = async (tenantId: string, userId: string): Promise<Eff | undefined> => {
  const r = await call(c.hub, "GET", `/agent-grants/effective/${userId}?tenant_id=${tenantId}`, {
    token: await c.tok(P.padmin),
  });
  return r.status === 200 ? (r.json as Eff) : undefined;
};
const canUse = (e: Eff | undefined, key: string) =>
  e?.agents.some((a) => a.agent.key === key && a.visible) === true;
const hubRows = async (tenantId: string, agentId: string) => {
  const [r] = await c.sql<{ ent: number; grants: string[] }[]>`select
      (select count(*)::int from hub.agent_entitlements
        where tenant_id = ${tenantId} and agent_id = ${agentId} and revoked_at is null) as ent,
      coalesce((select array_agg(gr.key order by gr.key) from hub.agent_grants g
        join admin.groups gr on gr.id = g.subject_id and g.subject_type = 'group'
        where g.tenant_id = ${tenantId} and g.agent_id = ${agentId}), '{}') as grants`;
  return { ent: r?.ent ?? 0, grants: [...(r?.grants ?? [])] };
};
const hubVersion = async () =>
  Number(
    (
      await c.sql<{ v: number }[]>`select hub_config_version as v from hub.config_meta where id = 1`
    )[0]?.v,
  );
const ROLE_GROUPS = ["editor", "owner", "viewer"].map((r) => packGroupKey(PK, r));

describe("B4 · bật gói ⇒ trợ lý của gói dùng được ngay (không cần hub:seed)", () => {
  it("tenant MỚI bật gói ⇒ entitlement + grant 3 Group vai (cùng tx); owner dùng được trợ lý; tenant khác không có gì", async () => {
    await needPackKit(c.sql);
    const v0 = await hubVersion();
    await c.enable(DELTA);
    expect(await hubRows(DELTA, AGENT.id)).toEqual({ ent: 1, grants: ROLE_GROUPS });
    expect(await hubVersion()).toBeGreaterThan(v0);
    // Tenant khác (acme, chưa bật gói) không nhận entitlement/grant nào của trợ lý.
    expect(await hubRows(T.acme, AGENT.id)).toEqual({ ent: 0, grants: [] });

    await c.addToRole(DELTA, "owner", [OWNER]);
    const e = await untilHubSettles(
      c.hub,
      () => effective(DELTA, OWNER.id),
      (v) => canUse(v, AGENT.key),
    );
    expect(canUse(e, AGENT.key)).toBe(true);
    expect(canUse(await effective(T.acme, P.lan.id), AGENT.key)).toBe(false);
  });

  it("PUT lặp (đã bật) ⇒ không ghi thêm, không bump hub_config_version", async () => {
    await needPackKit(c.sql);
    const v = await hubVersion();
    await c.enable(DELTA);
    expect(await hubVersion()).toBe(v);
    expect(await hubRows(DELTA, AGENT.id)).toEqual({ ent: 1, grants: ROLE_GROUPS });
  });

  it("agent tạo SAU khi bật gói ⇒ packs.grant_agents(k, null, null) (hub:seed gọi) bù cho tenant đã bật, không cho tenant khác", async () => {
    await needPackKit(c.sql);
    await insertAgent(LATE);
    expect(await hubRows(DELTA, LATE.id)).toEqual({ ent: 0, grants: [] });
    await c.sql`select packs.grant_agents(${PK}, null::uuid[], null::uuid)`;
    expect(await hubRows(DELTA, LATE.id)).toEqual({ ent: 1, grants: ROLE_GROUPS });
    expect(await hubRows(T.acme, LATE.id)).toEqual({ ent: 0, grants: [] });
  });

  it("admin_api chỉ được EXECUTE hàm, không ghi thẳng hub.agent_grants", async () => {
    const [r] = await c.sql<{ exec: boolean; ins: boolean }[]>`select
      has_function_privilege('admin_api', 'packs.grant_agents(text, uuid[], uuid)', 'EXECUTE') as exec,
      has_table_privilege('admin_api', 'hub.agent_grants', 'INSERT') as ins`;
    expect(r).toEqual({ exec: true, ins: false });
  });
});
