// CR-122 · M1 · FLOW2-FR-20 · int (DB thật `hub_api`): migration hub 0111 backfill khe → FlowDef + `company_flows` trên dữ liệu giống prod
// (công ty có luật phòng ban × loại HĐ + mặc định, bản riêng Q9 đã sao, công ty chưa có luật, lượt đang chạy). Chạy MIGRATION THẬT 3 lần
// (file SQL trong tx như drizzle) ⇒ kết quả y hệt; đường mới (`dispatchOnce`, cờ bật) chọn CÙNG flow với đường cũ (`routeSlot`);
// lượt cũ không đổi; def `dlc.*` không đụng; công ty khác không thấy dòng của nhau. `launch` giả (đếm), không engine.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_MANIFESTS } from "@ai/contracts/app-manifest";
import { flowDefIssues, parseFlowDef } from "@ai/contracts/hub-admin";
import { withHubScope } from "@ai/db/hub-scope";
import { groups, members, tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { sql } from "drizzle-orm";
import { insertRun } from "../../../../../../tests/acceptance/P-a/_support/process-fixtures";
import { connectDb, type Db } from "../../../lib/db";
import { APPROVAL_SLOT, compileSlotStages } from "../../packs/contracts/public";
import { dispatchOnce, type FlowLaunch } from "../triggers/dispatcher";
import { insertFlowEvents } from "../triggers/dispatcher.repo";
import { setFlowTriggers } from "../triggers/flags";
import { routeSlot } from "./slot-route.repo";

const X = tenantId(1241); // luật phòng ban (→ A) + mặc định (→ B)
const W = tenantId(1242); // luật phòng ban × loại HĐ, KHÔNG mặc định
const Z = tenantId(1243); // bản riêng Q9 (sao từ B) là luật mặc định
const Y = tenantId(1244); // bật app nhưng chưa có luật ⇒ mẫu khe
const U = {
  xKd: userId(1241),
  xOps: userId(1242),
  wKd: userId(1243),
  wBgd: userId(1244),
  z: userId(1245),
  y: userId(1246),
};
const SYS = { kind: "system" as const };
const T0 = new Date(Date.now() + 60_000);
const MIGRATION = readFileSync(
  join(import.meta.dir, "../../../../../../packages/db/migrations-hub/0111_flow_backfill.sql"),
  "utf8",
);
const PARTS = MIGRATION.split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

let o: Sql;
let db: Db;
const lib = { a: "", b: "", c: "", dlc: "", ia: "", ib: "" };
const INTAKE_SLOT = "contracts.intake";
const copyZ = { id: "" };
const rel1: Record<string, string> = {};
const launched: string[] = [];
const launch: FlowLaunch = async (e, c) => {
  launched.push(`${e.ref}|${c.flowId}`);
  return { runId: crypto.randomUUID() };
};

const review = (key: string, dept: string) => ({
  kind: "review",
  key,
  name: `Duyệt ${key}`,
  department_group_id: null,
  department_group_key: dept,
  head_only: false,
  due_h: 72,
  remind_every_h: null,
  escalate_group_id: null,
  exclude_starter: false,
  when: null,
});
const stagesOf = (dept: string) =>
  JSON.stringify(compileSlotStages({ steps: [review("kt", dept)] }));

async function libDef(key: string, name: string, dept: string, slot = APPROVAL_SLOT) {
  const body = JSON.stringify({ steps: [review("kt", dept)] });
  const stages = stagesOf(dept);
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, slot, slot_body, published_version)
    values (null, ${key}, ${name}, ${stages}::text::jsonb, ${slot}, ${body}::text::jsonb, 1) returning id::text as id`;
  const id = r?.id as string;
  await o`insert into hub.process_def_releases (def_id, rel_version, name, stages, slot_body)
    values (${id}, 1, ${name}, ${stages}::text::jsonb, ${body}::text::jsonb)`;
  rel1[id] = stages;
  return id;
}

/** Chạy file migration THẬT trong một tx (như drizzle). */
const migrate = () =>
  o.begin(async (tx) => {
    for (const p of PARTS) await tx.unsafe(p);
  });

const flowsOf = async (t: string) =>
  o<
    {
      key: string;
      enabled: boolean;
      position: number;
      reason: string | null;
      replaced: boolean;
      when: boolean;
    }[]
  >`select d.key, cf.enabled, cf.position, cf.off_reason as reason, cf.replaced_by is not null as replaced,
      (d.trigger ? 'when') as "when"
    from hub.company_flows cf join hub.process_defs d on d.id = cf.flow_id
    where cf.tenant_id = ${t} and d.trigger_event = 'contract.submitted' order by cf.enabled desc, cf.position, d.key`;

/** Hàng postgres.js có thuộc tính phụ (count, statement…) ⇒ so qua JSON thuần. */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const snapshot = async () =>
  plain({
    defs: await o`select coalesce(tenant_id::text, '') as t, key, trigger::text as tr, app, published_version as pv,
      md5(stages::text) as h, jsonb_array_length(stages) as n from hub.process_defs order by 1, 2`,
    rels: await o`select d.key, r.rel_version as v, md5(r.stages::text) as h from hub.process_def_releases r
      join hub.process_defs d on d.id = r.def_id order by 1, 2`,
    flows:
      await o`select cf.tenant_id::text as t, d.key, cf.enabled, cf.position, cf.off_reason as r,
      cf.replaced_by is not null as rep from hub.company_flows cf join hub.process_defs d on d.id = cf.flow_id order by 1, 2`,
  });
const runSnap = async () =>
  plain(
    await o`select id::text as id, process_def_id::text as d, md5(snapshot::text) as h from hub.process_runs order by id`,
  );
const rootOf = async (defId: string) =>
  (
    await o<
      { r: string }[]
    >`select coalesce(source_template_id, id)::text as r from hub.process_defs where id = ${defId}`
  )[0]?.r;

let evSeq = 0;
/** Gửi sự kiện `contract.submitted`, chạy bộ điều phối MỘT lượt, trả flow đã mở (gốc Thư viện). */
async function newPath(
  t: string,
  actor: string,
  depts: string[],
  deal: string,
  event = "contract.submitted",
): Promise<string[]> {
  const ref = `m1-${++evSeq}`;
  const facts =
    event === "contract.uploaded"
      ? { file_type: "pdf", uploader_department: depts }
      : { total_value: 150_000_000, deal, creator_department: depts };
  await withHubScope(db, { kind: "user", tenantId: t, userId: actor }, (tx) =>
    insertFlowEvents(tx, [
      {
        tenantId: t,
        eventId: `m1:${ref}`,
        event,
        ref,
        facts: facts as never,
        actorId: actor,
      },
    ]),
  );
  launched.length = 0;
  await dispatchOnce({ db, launch, now: () => T0 });
  const mine = launched.filter((l) => l.startsWith(`${ref}|`));
  return Promise.all(mine.map((l) => rootOf(l.split("|")[1] as string) as Promise<string>));
}
async function oldPath(t: string, user: string, deal: string): Promise<string | null> {
  const r = await routeSlot(db, t, APPROVAL_SLOT, user, { contractKind: deal });
  return r && "defId" in r ? ((await rootOf(r.defId)) as string) : null;
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${X}, 't1241', 'X'), (${W}, 't1242', 'W'),
    (${Z}, 't1243', 'Z'), (${Y}, 't1244', 'Y')`;
  await users(o, X, 2, { from: 1241 });
  await users(o, W, 2, { from: 1243 });
  await users(o, Z, 1, { from: 1245 });
  await users(o, Y, 1, { from: 1246 });
  const keys = ["ke-toan", "phap-che", "kiem-soat"];
  const gx = await groups(o, X, [...keys, "kinh-doanh", "kd-bac", "van-hanh"]);
  const gw = await groups(o, W, [...keys, "kinh-doanh", "bgd"]);
  await groups(o, Z, keys);
  await groups(o, Y, keys);
  await o`insert into admin.departments (tenant_id, group_id, parent_group_id) values
    (${X}, ${gx.get("kinh-doanh") as string}, null), (${X}, ${gx.get("kd-bac") as string}, ${gx.get("kinh-doanh") as string}),
    (${X}, ${gx.get("van-hanh") as string}, null),
    (${W}, ${gw.get("kinh-doanh") as string}, null), (${W}, ${gw.get("bgd") as string}, null)`;
  await members(o, X, gx.get("kd-bac") as string, [U.xKd]);
  await members(o, X, gx.get("van-hanh") as string, [U.xOps]);
  await members(o, W, gw.get("kinh-doanh") as string, [U.wKd]);
  await members(o, W, gw.get("bgd") as string, [U.wBgd]);

  lib.a = await libDef("m1-a", "QT A", "ke-toan");
  lib.b = await libDef("m1-b", "QT B", "phap-che");
  lib.c = await libDef("m1-c", "QT C", "kiem-soat");
  lib.dlc = await libDef("m1-dlc", "DLC của Rowan", "ke-toan", "dlc.test");
  // Z: bản riêng Q9 sao từ B (đường cũ: luật mặc định trỏ BẢN RIÊNG; bản gốc B vẫn trong tập gán).
  const [cz] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, enabled, source_template_id, source_rel_version)
    values (${Z}, 'm1-b-riengz', 'QT B (riêng)', ${stagesOf("phap-che")}::text::jsonb, true, ${lib.b}, 1) returning id::text as id`;
  copyZ.id = cz?.id as string;

  const rule = (
    t: string,
    p: number,
    cond: object,
    def: string,
    dflt: boolean,
    slot = APPROVAL_SLOT,
  ) =>
    o`insert into hub.process_routing_rules (tenant_id, slot, priority, condition, def_id, is_default)
      values (${t}, ${slot}, ${p}, ${JSON.stringify(cond)}::text::jsonb, ${def}, ${dflt})`;
  const head = (t: string, defs: string[], slot = APPROVAL_SLOT) =>
    o`insert into hub.process_routings (tenant_id, slot) values (${t}, ${slot})`.then(
      () =>
        o`insert into hub.process_tenant_defs (tenant_id, def_id, slot)
        select ${t}, d, ${slot} from unnest(${o.array(defs)}::uuid[]) d`,
    );
  await head(X, [lib.a, lib.b]);
  await rule(X, 0, { departmentIds: [gx.get("kinh-doanh")] }, lib.a, false);
  await rule(X, 1, {}, lib.b, true);
  // X · khe Tiếp nhận (contract.uploaded, decides): luật phòng ban + mặc định.
  lib.ia = await libDef("m1-ia", "Nhận A", "ke-toan", INTAKE_SLOT);
  lib.ib = await libDef("m1-ib", "Nhận B", "phap-che", INTAKE_SLOT);
  await head(X, [lib.ia, lib.ib], INTAKE_SLOT);
  await rule(X, 0, { departmentIds: [gx.get("kinh-doanh")] }, lib.ia, false, INTAKE_SLOT);
  await rule(X, 1, {}, lib.ib, true, INTAKE_SLOT);
  await head(W, [lib.a, lib.b, lib.c]);
  await rule(W, 0, { departmentIds: [gw.get("kinh-doanh")], contractKinds: ["buy"] }, lib.a, false);
  await rule(
    W,
    1,
    { departmentIds: [gw.get("kinh-doanh")], contractKinds: ["sell"] },
    lib.b,
    false,
  );
  await rule(W, 2, { departmentIds: [gw.get("bgd")], contractKinds: ["buy"] }, lib.c, false);
  await head(Z, [lib.b, copyZ.id]);
  await rule(Z, 49, {}, copyZ.id, true);

  // Công ty đang dùng = có quyền `contracts-read`.
  let [f] = await o<{ id: string }[]>`select id from admin.features where key = 'contracts-read'`;
  if (!f)
    [f] = await o<
      { id: string }[]
    >`insert into admin.features (key, name) values ('contracts-read', ${o.json({ vi: "Hợp đồng", en: "Contracts" })}) returning id`;
  await o`insert into admin.feature_entitlements (feature_id, tenant_id)
    select ${f?.id as string}, t from unnest(${o.array([X, W, Z, Y])}::uuid[]) t on conflict do nothing`;

  // Lượt đang chạy của đường cũ (snapshot def cũ).
  await insertRun(o, {
    def: {
      id: lib.a,
      key: "m1-a",
      name: "QT A",
      stages: JSON.parse(stagesOf("ke-toan")) as never[],
    },
    startedBy: { tid: X, id: U.xKd } as never,
  });
});

afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-122 M1 · hub 0111 backfill", () => {
  let runsBefore: unknown;
  let after1: unknown;

  it("def Thư viện: trigger + app + Kết thúc, release mới v2, FlowDef hợp lệ; release v1 và slot_body giữ; dlc.* không đụng", async () => {
    runsBefore = await runSnap();
    await migrate();
    after1 = await snapshot();
    const [a] = await o<
      {
        trigger: { event: string };
        app: string;
        pv: number;
        stages: { outcome?: string }[];
        name: string;
      }[]
    >`select trigger, app, published_version as pv, stages, name from hub.process_defs where id = ${lib.a}`;
    expect(a?.trigger).toEqual({ event: "contract.submitted" });
    expect(a?.app).toBe("contracts");
    expect(a?.pv).toBe(2);
    expect(a?.stages.at(-1)?.outcome).toBe("approved");
    const rels = await o<
      { rel_version: number; stages: unknown[]; slot_body: unknown }[]
    >`select rel_version, stages, slot_body from hub.process_def_releases where def_id = ${lib.a} order by 1`;
    expect(rels.map((r) => r.rel_version)).toEqual([1, 2]);
    expect(rels[0]?.stages).toEqual(JSON.parse(rel1[lib.a] as string));
    expect(rels[1]?.slot_body).toEqual(rels[0]?.slot_body);
    const parsed = parseFlowDef({
      key: "m1-a",
      name: a?.name,
      app: a?.app,
      owner: "library",
      trigger: a?.trigger,
      stages: rels[1]?.stages,
      source: null,
      version: 2,
    });
    expect(parsed.ok && !parsed.legacy).toBe(true);
    if (parsed.ok && !parsed.legacy)
      expect(flowDefIssues(parsed.def, APP_MANIFESTS.contracts?.events)).toEqual([]);
    // flow mặc định seed (hd-mac-dinh) và Nhận HĐ cũng thành FlowDef
    const seeds = await o<
      { key: string; ev: string | null }[]
    >`select key, trigger_event as ev from hub.process_defs where tenant_id is null and key in ('hd-mac-dinh', 'hd-nhan-hop-dong') order by key`;
    expect(plain(seeds) as unknown).toEqual([
      { key: "hd-mac-dinh", ev: "contract.submitted" },
      { key: "hd-nhan-hop-dong", ev: "contract.uploaded" },
    ]);
    const [d] = await o<{ trigger: unknown; pv: number }[]>`select trigger, published_version as pv
      from hub.process_defs where id = ${lib.dlc}`;
    expect(d).toEqual({ trigger: null, pv: 1 });
  });

  it("company_flows theo luật cũ: điều kiện ở trigger + position = priority, mặc định cuối, bản riêng Q9 thay gốc", async () => {
    const x = await flowsOf(X);
    expect(x.filter((r) => r.enabled).map((r) => [r.position, r.when])).toEqual([
      [0, true],
      [901, false],
    ]);
    expect(x.find((r) => r.key === "m1-b")?.enabled).toBe(true);
    expect(x.find((r) => r.key === "m1-a")).toMatchObject({ enabled: false, reason: "turned_off" });
    const w = await flowsOf(W);
    expect(w.filter((r) => r.enabled).map((r) => r.position)).toEqual([0, 1, 2]);
    expect(w.every((r) => !r.enabled || r.when)).toBe(true); // W không có mặc định ⇒ không có flow không điều kiện (đúng đường cũ: chặn)
    const z = await flowsOf(Z);
    expect(z.find((r) => r.key === "m1-b-riengz")).toMatchObject({
      enabled: true,
      position: 949,
      when: false,
    });
    expect(z.find((r) => r.key === "m1-b")).toMatchObject({
      enabled: false,
      reason: "replaced",
      replaced: true,
    });
    const y = await flowsOf(Y); // chưa có luật ⇒ mẫu khe
    expect(y.map((r) => [r.key, r.enabled, r.position])).toEqual([["hd-mac-dinh", true, 900]]);
  });

  it("chạy lại lần 2 và 3: dữ liệu y hệt, không nhân đôi", async () => {
    await migrate();
    await migrate();
    expect(await snapshot()).toEqual(after1 as never);
  });

  it("lượt đang chạy (snapshot, def trỏ) không đổi", async () => {
    expect(await runSnap()).toEqual(runsBefore as never);
    const [n] = await o<{ n: number }[]>`select count(*)::int as n from hub.process_runs
      where flow_event_id is not null or company_flow_id is not null`;
    expect(n?.n).toBe(0);
  });

  it("contract.submitted (cờ bật) chọn đúng flow như đường khe cũ — mọi công ty", async () => {
    for (const t of [X, W, Z, Y]) await withHubScope(db, SYS, (tx) => setFlowTriggers(tx, t, true));
    const cases: [string, string, string[], string][] = [
      [X, U.xKd, ["kd-bac", "kinh-doanh"], "buy"], // luật phòng ban → A
      [X, U.xOps, ["van-hanh"], "sell"], // rơi về mặc định → B
      [W, U.wKd, ["kinh-doanh"], "buy"], // → A
      [W, U.wKd, ["kinh-doanh"], "sell"], // → B
      [W, U.wBgd, ["bgd"], "buy"], // → C
      [W, U.wBgd, ["bgd"], "sell"], // không luật khớp, không mặc định ⇒ cũ chặn, mới không chạy
      [Z, U.z, [], "buy"], // bản riêng thay gốc: cùng gốc B
      [Y, U.y, [], "buy"], // không luật ⇒ mẫu khe hd-mac-dinh
    ];
    for (const [t, u, depts, deal] of cases) {
      const old = await oldPath(t, u, deal);
      const neu = await newPath(t, u, depts, deal);
      expect(neu, `${t.slice(-4)} ${depts.join("+")} ${deal}`).toEqual(old === null ? [] : [old]);
    }
    expect((await oldPath(X, U.xKd, "buy")) === lib.a).toBe(true);
    expect((await oldPath(W, U.wBgd, "buy")) === lib.c).toBe(true);
  });

  it("contract.uploaded (decides): luật điều kiện (position = priority) đứng trước, mặc định (900+) sau ⇒ chỉ MỘT flow chạy, như đường cũ", async () => {
    const cases: [string, string[], string][] = [
      [U.xKd, ["kd-bac", "kinh-doanh"], lib.ia], // khớp luật phòng ban → A, mặc định B KHÔNG chạy thêm
      [U.xOps, ["van-hanh"], lib.ib], // không khớp → mặc định B
    ];
    for (const [u, depts, want] of cases) {
      const old = await routeSlot(db, X, INTAKE_SLOT, u, {});
      expect(old && "defId" in old ? await rootOf(old.defId) : null).toBe(want);
      expect(await newPath(X, u, depts, "", "contract.uploaded")).toEqual([want]);
    }
  });

  it("chặn chéo tenant: mỗi công ty chỉ thấy dòng của mình; không dòng nào trỏ def của công ty khác", async () => {
    const seen = (t: string) =>
      withHubScope(db, { kind: "user", tenantId: t, userId: U.y }, (tx) =>
        tx.execute<{ tenant_id: string }>(
          sql`select distinct tenant_id::text as tenant_id from hub.company_flows`,
        ),
      );
    expect((await seen(Y)).map((r) => r.tenant_id)).toEqual([Y]);
    const [cross] = await o<{ n: number }[]>`select count(*)::int as n from hub.company_flows cf
      join hub.process_defs d on d.id = cf.flow_id where d.tenant_id is not null and d.tenant_id <> cf.tenant_id`;
    expect(cross?.n).toBe(0);
    const [rep] = await o<{ n: number }[]>`select count(*)::int as n from hub.company_flows cf
      join hub.company_flows t on t.id = cf.replaced_by where t.tenant_id <> cf.tenant_id`;
    expect(rep?.n).toBe(0);
    // bản công ty tạo từ luật điều kiện: Group id trong stages thuộc ĐÚNG công ty của bản
    const [bad] = await o<{ n: number }[]>`select count(*)::int as n from hub.process_defs d,
      jsonb_array_elements(d.stages) s
      where d.tenant_id is not null and d.trigger ? 'when' and s -> 'after' ->> 'group_id' is not null
        and not exists (select 1 from admin.groups g where g.id = (s -> 'after' ->> 'group_id')::uuid and g.tenant_id = d.tenant_id)`;
    expect(bad?.n).toBe(0);
  });
});
