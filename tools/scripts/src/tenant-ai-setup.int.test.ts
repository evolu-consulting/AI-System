// CR-159 · tenant-ai-setup (cùng hàm `run` mà onboard-all.sh gọi) trên DB thật: công ty mới chưa có AI ⇒ --apply cài đủ (agent
// assistant, cấp cho nhóm có quyền contracts, gói knowledge, agent mặc định); chạy lại không đổi gì (không tăng version cấu hình);
// chạy thử không ghi. Không cần đăng nhập nhà cung cấp AI (chỉ SQL).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { run } from "./tenant-ai-setup";

const T = "01900000-0000-7000-8000-000000c15921";
const G = "01900000-0000-7000-8000-000000c15922";
let o: Sql;

const counts = async () =>
  (
    await o<
      {
        ent: number;
        grants: number;
        kfeat: number;
        kgrants: number;
        def: string | null;
        hv: number;
      }[]
    >`select
      (select count(*) from hub.agent_entitlements where tenant_id = ${T})::int as ent,
      (select count(*) from hub.agent_grants where tenant_id = ${T})::int as grants,
      (select count(*) from admin.feature_entitlements e join admin.features f on f.id = e.feature_id
        where e.tenant_id = ${T} and f.key like 'knowledge-%')::int as kfeat,
      (select count(*) from admin.feature_grants g join admin.features f on f.id = g.feature_id
        where g.tenant_id = ${T} and f.key like 'knowledge-%')::int as kgrants,
      (select a.key from hub.tenant_agent_defaults d join hub.agents a on a.id = d.default_agent_id
        where d.tenant_id = ${T}) as def,
      (select hub_config_version from hub.config_meta where id = 1)::int as hv`
  )[0];

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  await o`insert into admin.tenants (id, key, name) values (${T}, 'ai-new', 'AI New')`;
  await o`insert into admin.groups (id, tenant_id, key, name) values (${G}, ${T}, 'editor', ${o.json({ vi: "Biên tập" })})`;
  for (const k of [
    "contracts-read",
    "contracts-write",
    "contracts-admin",
    "knowledge-read",
    "knowledge-write",
    "knowledge-admin",
  ])
    await o`insert into admin.features (key, name, app) values (${k}, ${o.json({ vi: k, en: k })},
      ${k.split("-")[0] ?? k}) on conflict (key) do nothing`;
  await o`insert into admin.feature_grants (tenant_id, feature_id, group_id)
    select ${T}, id, ${G} from admin.features where key = 'contracts-read'`;
  await o`insert into hub.providers (key, kind, vendor, max_concurrency, enabled, dev_only)
    values ('fake-cli', 'subscription', 'fake', 2, true, true) on conflict do nothing`;
  const [p] = await o<
    { id: string }[]
  >`insert into hub.model_profiles (key, steps) values ('fake-ai-setup',
    ${o.json([{ provider_key: "fake-cli", model: null, on: [] }])}) returning id`;
  await o`insert into hub.agents (key, name, description, runtime, profile_id)
    values ('assistant', ${o.json({ vi: "Trợ lý", en: "Assistant" })}, 'Trợ lý chung của công ty, dùng thử.', 'agentic-cli', ${p?.id as string})
    on conflict (key) do nothing`;
});
afterAll(async () => {
  await o?.end();
});

describe("CR-159 · tenant-ai-setup", () => {
  it("chạy thử không ghi, --apply cài đủ, chạy lại không đổi", async () => {
    const dry = await run(o, "ai-new", false);
    expect(dry.entitlement).toBe(true);
    expect((await counts())?.ent).toBe(0);

    await run(o, "ai-new", true);
    const a = await counts();
    expect(a).toMatchObject({ ent: 1, grants: 1, kfeat: 3, kgrants: 1, def: "assistant" });

    const again = await run(o, "ai-new", true);
    expect(again).toMatchObject({
      entitlement: false,
      agentGrants: 0,
      knowledgePack: 0,
      defaultAgent: false,
    });
    expect(await counts()).toEqual(a);
  });
});
