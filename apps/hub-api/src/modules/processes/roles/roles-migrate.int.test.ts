// CR-182 · lát cr182-migrate · int (DB thật): migration hub 0160 điền vai + giao việc từ cấu hình cũ (CHẠY MIGRATION THẬT, 2 lần), công tắc lùi
// `on_doc_enabled` ở bước Ký có vai, chuông «Chưa giao người» cho quản trị công ty.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createDb, type Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { contracts, groups, tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { bellRoleUnassigned } from "../../packs/contracts/adapters/role-unassigned-bell";
import { bindGroupKeys } from "../triggers/group-keys.rules";
import { applyRoles, resolveRunRoles } from "./roles.repo";

const T = { a: tenantId(1830), b: tenantId(1831) };
const U = { adm: userId(1830), u2: userId(1831), u3: userId(1832), b1: userId(1833) };
const MIGRATION = readFileSync(
  join(
    import.meta.dir,
    "../../../../../../packages/db/migrations-hub/0160_cr182_roles_backfill.sql",
  ),
  "utf8",
);
const PARTS = MIGRATION.split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

// biome-ignore lint/suspicious/noExplicitAny: jsonb stage dựng tay trong test
type Stg = any;
let o: Sql;
let db: Db;
let gA = "";
let gB = "";
let gC = "";
const ids = { d1: "", d2: "", d3: "", lib: "", dlc: "", run: "" };
const c = (v: string) => ({ from: "const", value: v });
const SIGN = (signers: string) => ({
  name: "Ký",
  executor: {
    kind: "tool",
    tool_key: "contracts-esign-send",
    args: { provider: c("docusign"), company_signers: c(signers) },
  },
});
const migrate = () =>
  o.begin(async (tx) => {
    for (const p of PARTS) await tx.unsafe(p);
  });
const stagesOf = async (id: string) =>
  (await o<{ stages: Stg[] }[]>`select stages from hub.process_defs where id = ${id}`)[0]
    ?.stages as Stg[];
const assignments = async (flow: string) =>
  Array.from(
    await o<
      { tenant_id: string; role_key: string; group_id: string | null; user_id: string | null }[]
    >`
    select tenant_id::text, role_key, group_id::text, user_id::text from hub.process_role_assignments
    where flow_id = ${flow} order by tenant_id, role_key`,
  );
const everything = async () =>
  JSON.stringify([
    await o`select id::text, stages from hub.process_defs where id in ${o(Object.values(ids).filter(Boolean))} order by id`,
    await o`select def_id::text, stages from hub.process_def_releases where def_id = ${ids.lib}`,
    await o`select tenant_id::text, flow_id::text, role_key, group_id::text, user_id::text from hub.process_role_assignments order by 1, 2, 3`,
    await o`select id::text, snapshot from hub.process_runs where id = ${ids.run}`,
  ]);

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  await o`insert into admin.tenants (id, key, name) values (${T.a}, 'p1830', 'P1830'), (${T.b}, 'p1831', 'P1831') on conflict do nothing`;
  await users(o, T.a, 3, { from: 1830 });
  await users(o, T.b, 1, { from: 1833 });
  await o`update admin.users set role = 'tenant_admin' where id = ${U.adm}`;
  const ga = await groups(o, T.a, ["ga", "gb", "gc"]);
  gA = ga.get("ga") as string;
  gB = ga.get("gb") as string;
  gC = ga.get("gc") as string;
  await groups(o, T.b, ["gx"]); // công ty B không có nhóm mã `ga`
  const ins = async (
    tenant: string | null,
    key: string,
    stages: unknown[],
    slot: string | null = null,
  ) =>
    (
      await o<
        { id: string }[]
      >`insert into hub.process_defs (tenant_id, key, name, stages, trigger, app, slot)
        values (${tenant}, ${key}, ${key}, ${JSON.stringify(stages)}::text::jsonb, '{"event":"contract.submitted"}'::jsonb, 'contracts', ${slot})
        returning id::text as id`
    )[0]?.id as string;
  const D1 = [
    {
      name: "D1",
      after: { kind: "review", group_id: gA, escalate: { after_h: 24, group_id: gC } },
    },
    {
      name: "D2",
      after: {
        kind: "review",
        group_id: null,
        parallel: {
          rule: "all",
          groups: [
            { group_id: gA, label: "A" },
            { group_id: gB, label: "B" },
          ],
        },
      },
    },
    SIGN(`group:${gB}`),
    { name: "D4", after: { kind: "review", approver_user_id: U.u2 } },
  ];
  ids.d1 = await ins(T.a, "cr182-m-d1", D1);
  ids.d2 = await ins(T.a, "cr182-m-multi", [SIGN(`user:${U.u2},group:${gB}`)]);
  // vừa nhóm vừa người duyệt cụ thể (người cụ thể thắng) ⇒ MƠ HỒ, migration bỏ qua
  ids.d3 = await ins(T.a, "cr182-m-both", [
    { name: "B", after: { kind: "review", group_id: gA, approver_user_id: U.u2 } },
  ]);
  const LIB = [{ name: "L1", after: { kind: "review", group_key: "ga" } }];
  ids.lib = await ins(null, "cr182-m-lib", LIB);
  ids.dlc = await ins(
    null,
    "cr182-m-dlc",
    [{ name: "X", after: { kind: "review", group_id: gA } }],
    "dlc.x",
  );
  await o`insert into hub.process_def_releases (def_id, rel_version, name, stages) values (${ids.lib}, 1, 'r1', ${JSON.stringify(LIB)}::text::jsonb)`;
  await o`insert into hub.company_flows (tenant_id, flow_id, enabled) values (${T.a}, ${ids.lib}, true), (${T.b}, ${ids.lib}, true)`;
  // lượt ĐANG CHẠY giữ ảnh chụp cũ (snapshot dựng bằng tay, trigger tắt như run-links.sibling)
  const [cv] = await o<
    { id: string }[]
  >`insert into hub.conversations (tenant_id, user_id, title, title_norm) values (${T.a}, ${U.adm}, 'c', 'c') returning id::text as id`;
  ids.run = Bun.randomUUIDv7();
  await o.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`insert into hub.process_runs (id, tenant_id, process_def_id, def_version, snapshot, started_by, origin_kind, input, conversation_id, flow_id, expires_at, status)
      values (${ids.run}, ${T.a}, ${ids.d1}, 1, ${JSON.stringify({ stages: D1 })}::text::jsonb, ${U.adm}, 'admin', 'r', ${cv?.id as string}, gen_random_uuid(), now() + interval '1 day', 'running')`;
  });
  db = createDb(urls().hubApi, { max: 4 });
}, 120_000);
afterAll(async () => {
  await o?.end({ timeout: 2 });
});

describe("CR-182 · hub 0160 điền vai + giao việc", () => {
  let before = "";
  let runBefore = "";
  it("def cũ (nhóm, nhóm cùng duyệt, chuyển cấp, người duyệt, Ký 1 nhóm) ⇒ có vai + giao việc đúng, trường cũ GIỮ, mẫu dlc, Ký nhiều người, lượt đang chạy không đổi", async () => {
    const dlcBefore = JSON.stringify(await stagesOf(ids.dlc));
    runBefore = JSON.stringify(
      await o`select snapshot from hub.process_runs where id = ${ids.run}`,
    );
    await migrate();
    const s = await stagesOf(ids.d1);
    const roleA = s[0].after.role;
    expect(roleA).toMatchObject({ label: "ga" }); // nhãn = tên nhóm
    expect(s[0].after.group_id).toBe(gA); // GIỮ trường cũ
    expect(s[0].after.escalate).toMatchObject({ group_id: gC, role: { label: "gc" } });
    expect(s[1].after.parallel.groups[0].role).toEqual(roleA); // cùng nhóm ⇒ cùng vai
    expect(s[1].after.parallel.groups[1].role.label).toBe("gb");
    expect(s[2].executor.args.signer_role).toEqual(c("nguoi-ky-hop-dong"));
    expect(s[2].executor.args.provider).toEqual(c("docusign")); // cũ giữ
    expect(s[2].executor.args.company_signers).toEqual(c(`group:${gB}`));
    expect(s[3].after.role.label).toMatch(/^Người duyệt cấp \d$/);
    const a = await assignments(ids.d1);
    const by = new Map(a.map((x) => [x.role_key, x]));
    expect(by.get(roleA.key)).toMatchObject({ tenant_id: T.a, group_id: gA, user_id: null });
    expect(by.get(s[0].after.escalate.role.key)?.group_id).toBe(gC);
    expect(by.get(s[1].after.parallel.groups[1].role.key)?.group_id).toBe(gB);
    expect(by.get("nguoi-ky-hop-dong")?.group_id).toBe(gB);
    expect(by.get(s[3].after.role.key)).toMatchObject({ group_id: null, user_id: U.u2 });
    expect(a.length).toBe(5);
    // Ký NHIỀU người: không thêm vai, không giao việc (giữ cấu hình cũ)
    expect((await stagesOf(ids.d2))[0].executor.args.signer_role).toBeUndefined();
    expect((await assignments(ids.d2)).length).toBe(0);
    // vừa nhóm vừa người ⇒ bỏ qua: không vai, không giao việc, giữ cả hai trường cũ
    const both = (await stagesOf(ids.d3))[0].after;
    expect(both.role).toBeUndefined();
    expect([both.group_id, both.approver_user_id]).toEqual([gA, U.u2]);
    expect((await assignments(ids.d3)).length).toBe(0);
    // mẫu của Rowan (dlc.*) không đổi
    expect(JSON.stringify(await stagesOf(ids.dlc))).toBe(dlcBefore);
    // lượt đang chạy: ảnh chụp không đổi
    expect(
      JSON.stringify(await o`select snapshot from hub.process_runs where id = ${ids.run}`),
    ).toBe(runBefore);
    before = await everything();
  });

  it("def Thư viện theo MÃ nhóm: công ty có nhóm cùng mã ⇒ giao, công ty không có ⇒ chưa giao, bản xuất bản nhận cùng vai", async () => {
    const s = await stagesOf(ids.lib);
    const key = s[0].after.role.key;
    expect(s[0].after.group_key).toBe("ga");
    expect(s[0].after.role.label).toBe("Người duyệt cấp 1"); // Thư viện dùng chung nhiều công ty ⇒ nhãn theo cấp
    const [rel] = await o<
      { stages: Stg[] }[]
    >`select stages from hub.process_def_releases where def_id = ${ids.lib}`;
    expect(rel?.stages[0].after.role.key).toBe(key);
    expect(await assignments(ids.lib)).toEqual([
      { tenant_id: T.a, role_key: key, group_id: gA, user_id: null },
    ]);
  });

  it("chạy migration LẦN HAI ⇒ không nhân đôi, không đổi gì, hàng quản trị đã bỏ giao không hồi sinh", async () => {
    await migrate();
    expect(await everything()).toBe(before);
    await o`delete from hub.process_role_assignments where flow_id = ${ids.d1} and role_key = 'nguoi-ky-hop-dong'`;
    await migrate();
    expect((await assignments(ids.d1)).map((x) => x.role_key)).not.toContain("nguoi-ky-hop-dong");
    expect(
      JSON.stringify(await o`select snapshot from hub.process_runs where id = ${ids.run}`),
    ).toBe(runBefore);
    await o`insert into hub.process_role_assignments (tenant_id, flow_id, role_key, group_id) values (${T.a}, ${ids.d1}, 'nguoi-ky-hop-dong', ${gB})`;
  });
});

describe("CR-182 · công tắc lùi on_doc_enabled ở bước Ký có vai", () => {
  const resolve = () =>
    withHubScope(db, { kind: "user", tenantId: T.a, userId: U.adm }, async (tx) => {
      const s = await stagesOf(ids.d1);
      return (await applyRoles(tx, T.a, ids.d1, s)).stages[2] as {
        executor: { args: Record<string, unknown> };
      };
    });
  it("công ty TẮT ⇒ giữ provider cũ + người ký như cũ, BẬT ⇒ provider = ondoc, người ký từ vai (bỏ provider cũ)", async () => {
    await o`delete from hub.signature_settings where tenant_id = ${T.a}`;
    const off = await resolve();
    expect(off.executor.args.provider).toEqual(c("docusign"));
    expect(off.executor.args.company_signers).toEqual(c(`group:${gB}`));
    await o`insert into hub.signature_settings (tenant_id, on_doc_enabled) values (${T.a}, true)
      on conflict (tenant_id) do update set on_doc_enabled = true`;
    const on = await resolve();
    expect(on.executor.args.provider).toEqual(c("ondoc"));
    expect(on.executor.args.company_signers).toEqual(c(`group:${gB}`));
    // đổi giao việc ⇒ người ký mới theo vai
    await o`update hub.process_role_assignments set group_id = ${gC} where flow_id = ${ids.d1} and role_key = 'nguoi-ky-hop-dong'`;
    expect((await resolve()).executor.args.company_signers).toEqual(c(`group:${gC}`));
  });
});

describe("CR-182 · vai CHƯA giao mà còn cấu hình cũ ⇒ chạy như trước, không chặn", () => {
  const tenantWithGa = async (n: number) => {
    const tid = tenantId(n);
    await o`insert into admin.tenants (id, key, name) values (${tid}, ${"p" + n}, ${"P" + n}) on conflict do nothing`;
    const gid = (await groups(o, tid, ["ga"])).get("ga") as string;
    return { tid, gid };
  };
  const resolveFor = async (tid: string, gid: string) => {
    const stages = bindGroupKeys(await stagesOf(ids.lib), new Map([["ga", gid]])).stages;
    return withHubScope(db, { kind: "system" }, (tx) =>
      resolveRunRoles(tx, tid, { id: ids.lib, stages }),
    );
  };
  it("(a) công ty dùng mẫu Thư viện qua khe (không có company_flows, không hàng giao) ⇒ việc đúng nhóm như trước", async () => {
    const { tid, gid } = await tenantWithGa(1832);
    const r = await resolveFor(tid, gid);
    expect((r.stages[0] as Stg).after.group_id).toBe(gid);
    expect(r.unassigned.filter((x) => x.blocking)).toEqual([]);
  });
  it("(b) công ty được gán mẫu SAU ngày migrate (có company_flows, chưa có hàng giao) ⇒ việc đúng nhóm như trước", async () => {
    const { tid, gid } = await tenantWithGa(1833);
    await o`insert into hub.company_flows (tenant_id, flow_id, enabled) values (${tid}, ${ids.lib}, true)`;
    const r = await resolveFor(tid, gid);
    expect((r.stages[0] as Stg).after.group_id).toBe(gid);
    expect(r.unassigned.filter((x) => x.blocking)).toEqual([]);
  });
  it("quy trình kiểu MỚI (vai, không còn cấu hình cũ) chưa giao ⇒ vẫn chặn ROLE_UNASSIGNED", async () => {
    const stages = [
      { name: "N", after: { kind: "review", group_id: null, role: { key: "moi", label: "Mới" } } },
    ];
    const run = withHubScope(db, { kind: "system" }, (tx) =>
      resolveRunRoles(tx, T.a, { id: ids.lib, stages }),
    );
    await expect(run).rejects.toMatchObject({ code: "ROLE_UNASSIGNED" });
  });
});

describe("CR-182 · chuông «Chưa giao người»", () => {
  it("vai chưa giao ⇒ chuông tới quản trị công ty (không tới người thường), nội dung + link đúng, gửi lại không nhân đôi, mã không phải vai ⇒ không chuông", async () => {
    const [hd] = await contracts(o, T.a, 1, { createdBy: U.adm, status: "processing" });
    const key = (await stagesOf(ids.d1))[0].after.role.key as string;
    const run = (reason: string) =>
      withHubScope(db, { kind: "system" }, (tx) =>
        bellRoleUnassigned(tx, { tenantId: T.a, ref: hd as string, reason }),
      );
    expect(await run(`FLOW_GROUP_MISSING:${key}`)).toBe(1);
    expect(await run(`FLOW_GROUP_MISSING:${key}`)).toBe(0);
    expect(await run("FLOW_GROUP_MISSING:khong-phai-vai")).toBe(0);
    expect(await run("FLOW_REFUSED")).toBe(0);
    // vai người ký ({from,value}, không nhãn trong def) ⇒ nhãn cố định
    const [hd2] = await contracts(o, T.a, 1, { from: 2, createdBy: U.adm, status: "processing" });
    const n2 = await withHubScope(db, { kind: "system" }, (tx) =>
      bellRoleUnassigned(tx, {
        tenantId: T.a,
        ref: hd2 as string,
        reason: "FLOW_GROUP_MISSING:nguoi-ky-hop-dong",
      }),
    );
    expect(n2).toBe(1);
    const [b2] = await o<
      { body: string }[]
    >`select body from hub.notifications where tenant_id = ${T.a} and body like '%HD 2%'`;
    expect(b2?.body).toBe("Hợp đồng HD 2 đang chờ: vai Người ký hợp đồng chưa giao người.");
    const rows = await o<{ user_id: string; title: string; body: string; link: string }[]>`
      select user_id::text, title, body, link from hub.notifications where tenant_id = ${T.a} and kind = 'contract.role_unassigned'`;
    expect(rows.filter((r) => r.body.includes("HD 1")).length).toBe(1);
    expect(rows.find((r) => r.body.includes("HD 1"))).toMatchObject({
      user_id: U.adm,
      title: "Chưa giao người",
      link: "/contracts/settings?sec=flow",
      body: "Hợp đồng HD 1 đang chờ: vai ga chưa giao người.",
    });
  });
});
