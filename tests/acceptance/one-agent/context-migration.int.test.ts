// one-agent · int DB thật: (1) nhãn bản ghi đang xem của dock chỉ chèn khi người gọi THẤY bản ghi (registry gói + `PackUow`
// contracts RLS + luật thấy M1 org): chủ HĐ thấy tên; đồng nghiệp ngang hàng / tenant khác ⇒ không chèn gì; đối tác tương tự.
// (2) hub 0051: grant / entitlement / agent mặc định của `mgmt-assistant` chuyển sang `assistant` (chỗ chưa có), agent cũ tắt +
// bỏ `studio_overrides`; chạy lại vô hại.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { createDb, type Db } from "@ai/db";
import { contracts, enablePack, members, tenants, users, visibility } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { contractsContextSource } from "../../../apps/hub-api/src/modules/packs/contracts/context.mount";
import type { PackAccessView } from "../../../apps/hub-api/src/modules/packs/kit/adapters/pack-guard.middleware";
import { PackToolRegistry } from "../../../apps/hub-api/src/modules/packs/kit/adapters/pack-tools.registry";
import { surfaceNote } from "../../../apps/hub-api/src/modules/runs/surface-context";

const FEAT = "7e5d0000-0000-4000-8000-0000000001b1";
let owner: Sql;
let db: Db;
let reg: PackToolRegistry;
let A = "";
let B = "";
let ua1 = "";
let ua2 = "";
let ub1 = "";
let hA = "";
let party = "";

const view = (): PackAccessView => ({
  catalog: async () => ({
    features: [{ id: FEAT, key: "contracts-read", status: "on" }],
    entitled: new Set([`${A}:${FEAT}`, `${B}:${FEAT}`]),
    grantGroups: new Map([
      [`${A}:${FEAT}`, ["g"]],
      [`${B}:${FEAT}`, ["g"]],
    ]),
  }),
  user: async (id) => {
    if (id === ub1) return { tenantId: B, groupIds: new Set(["g"]) };
    return [ua1, ua2].includes(id) ? { tenantId: A, groupIds: new Set(["g"]) } : undefined;
  },
});

beforeAll(async () => {
  await cloneDb("full");
  owner = openOwner(2);
  [A, B] = (await tenants(owner, 2, 1601)) as [string, string];
  [ua1, ua2] = (await users(owner, A, 2, { from: 1601 })) as [string, string];
  [ub1] = (await users(owner, B, 1, { from: 1603 })) as [string];
  const roles = await enablePack(owner, [A, B], "contracts");
  await members(owner, A, roles.get(A)?.editor as string, [ua1, ua2]);
  await members(owner, B, roles.get(B)?.editor as string, [ub1]);
  await visibility(owner, [A], "org");
  [hA] = (await contracts(owner, A, 1, { from: 1601, createdBy: ua1, owner: ua1 })) as [string];
  await owner`update contracts.contracts set title = 'HĐ mua phôi thép',
      fields = fields || jsonb_build_object(
        'number', jsonb_build_object('value', 'PT-01'),
        'supplier_name', jsonb_build_object('value', 'Công ty Phôi Thép Nam'),
        'supplier_tax_id', jsonb_build_object('value', '0101999'))
    where id = ${hA}`;
  [{ party }] = (await owner<{ party: string }[]>`
    select contracts.party_key('Công ty Phôi Thép Nam', '0101999') as party`) as unknown as [
    { party: string },
  ];
  db = createDb(urls().hubApi, { max: 2 });
  reg = new PackToolRegistry(view());
  reg.registerContext(contractsContextSource(db));
}, 120_000);
afterAll(async () => {
  await db?.close();
  await owner?.end({ timeout: 2 });
});

const note = (tenantId: string, userId: string, kind: "contract" | "partner", id: string) =>
  surfaceNote(reg, { tenantId, userId }, { surface: "contracts", entity: { kind, id } }, null);

describe("one-agent · nhãn bản ghi đang xem theo RLS người gọi", () => {
  it("chủ HĐ thấy tên + số; ngang hàng và tenant khác ⇒ không chèn", async () => {
    expect(await note(A, ua1, "contract", hA)).toContain('Hợp đồng "HĐ mua phôi thép" (số PT-01)');
    for (const n of [await note(A, ua2, "contract", hA), await note(B, ub1, "contract", hA)]) {
      expect(n).toContain("Sổ Hợp Tác");
      expect(n).not.toContain("phôi thép");
      expect(n).not.toContain(hA);
    }
  });

  it("đối tác: chỉ khi thấy HĐ có đối tác đó", async () => {
    expect(await note(A, ua1, "partner", party)).toContain('Đối tác "Công ty Phôi Thép Nam"');
    expect(await note(A, ua2, "partner", party)).not.toContain("Phôi Thép");
  });
});

const MIG = new URL("../../../packages/db/migrations-hub/0051_one_assistant.sql", import.meta.url);
const runMig = () => owner.unsafe(readFileSync(MIG, "utf8"));

async function agentId(key: string, overrides: string[]): Promise<string> {
  // DB mẫu chưa seed Hub ⇒ provider + profile tối thiểu (như NITI/onboard).
  await owner`insert into hub.providers (key, kind, vendor) values ('oa-fake', 'subscription', 'fake')
    on conflict (key) do nothing`;
  const [p] = await owner<{ id: string }[]>`insert into hub.model_profiles (key, steps)
    values ('oa-fake-1', ${owner.json([{ provider_key: "oa-fake", model: null, on: [] }])})
    on conflict (key) do update set key = excluded.key returning id`;
  if (!p) throw new Error("không tạo được model profile");
  const [a] = await owner<{ id: string }[]>`insert into hub.agents
      (key, name, description, runtime, profile_id, studio_overrides)
    values (${key}, ${owner.json({ vi: key, en: key })}, 'Trợ lý dùng cho kiểm thử gộp agent.', 'agentic-cli',
      ${p.id}, ${overrides})
    on conflict (key) do update set enabled = true, studio_overrides = excluded.studio_overrides
    returning id`;
  return a?.id as string;
}

describe("one-agent · hub 0051 gộp mgmt-assistant ⇒ assistant", () => {
  it("chuyển grant/entitlement/mặc định chỗ chưa có, tắt agent cũ, chạy lại vô hại", async () => {
    const neo = await agentId("assistant", ["system_prompt"]);
    const old = await agentId("mgmt-assistant", ["profile"]);
    const [g1, g2] = [crypto.randomUUID(), crypto.randomUUID()];
    await owner`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id) values
      (${old}, ${A}, 'group', ${g1}), (${old}, ${A}, 'group', ${g2}), (${neo}, ${A}, 'group', ${g2}),
      (${old}, ${B}, 'user', ${ub1})`;
    await owner`insert into hub.agent_entitlements (agent_id, tenant_id) values (${old}, ${A}), (${old}, ${B})
      on conflict do nothing`;
    await owner`insert into hub.tenant_agent_defaults (tenant_id, default_agent_id, on_no_match)
      values (${A}, ${old}, 'answer') on conflict (tenant_id) do update set default_agent_id = excluded.default_agent_id`;
    await runMig();
    const grants = await owner<
      { t: string; s: string }[]
    >`select tenant_id::text as t, subject_id::text as s
      from hub.agent_grants where agent_id = ${neo} and tenant_id in (${A}, ${B}) order by 1, 2`;
    expect(grants.map((g) => `${g.t}:${g.s}`).sort()).toEqual(
      [`${A}:${g1}`, `${A}:${g2}`, `${B}:${ub1}`].sort(),
    );
    const [{ n }] = (await owner<{ n: number }[]>`select count(*)::int as n from hub.agent_grants
      where agent_id = ${old}`) as unknown as [{ n: number }];
    expect(n).toBe(0);
    const ents = await owner<
      { t: string }[]
    >`select tenant_id::text as t from hub.agent_entitlements
      where agent_id = ${neo} and revoked_at is null and tenant_id in (${A}, ${B})`;
    expect(ents.map((e) => e.t).sort()).toEqual([A, B].sort());
    const [d] = await owner<
      { a: string }[]
    >`select default_agent_id::text as a from hub.tenant_agent_defaults
      where tenant_id = ${A}`;
    expect(d?.a).toBe(neo);
    const ag = await owner<{ key: string; enabled: boolean; o: string[] }[]>`select key, enabled,
      studio_overrides as o from hub.agents where id in (${old}, ${neo}) order by key`;
    expect(ag as unknown[]).toEqual([
      { key: "assistant", enabled: true, o: ["system_prompt"] },
      { key: "mgmt-assistant", enabled: false, o: [] },
    ]);
    const [v1] = await owner<{ v: number }[]>`select hub_config_version as v from hub.config_meta`;
    await runMig();
    const [v2] = await owner<{ v: number }[]>`select hub_config_version as v from hub.config_meta`;
    expect(v2?.v).toBe(v1?.v);
  });
});
