// CR-120 §3 · cr120-single-source · ADR-0036 · viết TRƯỚC code (làn đầy đủ: migration dữ liệu khách + RLS). DB thật (owner dựng
// dữ liệu, `hub_api` chạy code thật). Đưa DB về trạng thái TRƯỚC 0090/0091 (bảng gán cũ còn là bảng), dựng tenant đủ mọi ca, chụp
// def hiệu lực mỗi tenant × khe × dữ kiện lượt bằng câu tra CŨ (bản sao nguyên văn `RESOLVE_SLOT_SQL` CR-105 + luật CR-118), chạy
// 0090 + 0091 + `ensureSlotDefaults` (boot), rồi so với `routeSlot`/`resolveSlot` MỚI (chỉ đọc nguồn mới):
//   (1) launch (`routeSlot`) KHÔNG đổi cho mọi tenant; `resolveSlot` không đổi cho tenant không có luật. Tenant ĐÃ có luật (t3, t4):
//       câu cũ `resolveSlot` bỏ qua luật (lệch với launch) ⇒ nay theo luật mặc định / mẫu khe — giữ launch là chính (tasks.md);
//   (2) chạy lại 0090/0091/0099/ensure vô hại; (3) CR-121 A1 · hub 0099 gỡ VIEW `process_slot_assignments` (không còn đối tượng cùng
//       tên; 0099 không động tới BẢNG cùng tên khi DB chưa qua 0091), bảng `_legacy` không cấp cho hub_rw, dữ liệu cũ còn; (4)
//       resolveSlot/routeSlot chỉ đọc nguồn mới (không còn view nào để đọc).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { withHubScope } from "@ai/db/hub-scope";
import { enablePack, tenantId, userId } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { sql } from "drizzle-orm";
import { connectDb, type Db } from "../../../lib/db";
import { APPROVAL_DEFAULT_DEF } from "../../packs/contracts/domain/approval-slot-default.rules";
import { listDefs } from "../defs/defs.repo";
import { usage } from "./library.repo";
import { pickProcess, type RoutingRule } from "./routing.rules";
import { listAssignments } from "./slot-assign.repo";
import { ensureSlotDefaults } from "./slot-defaults";
import { resolveSlot } from "./slot-resolve.repo";
import { routeSlot } from "./slot-route.repo";

const SLOT = "contracts.approval";
const DFLT = APPROVAL_DEFAULT_DEF.id;
const SLOTS = [{ slot: SLOT, feature: "contracts-read" }];
const tid = (i: number) => tenantId(1300 + i);
/** SQLSTATE của lỗi (drizzle bọc lỗi postgres trong `cause`). */
const codeOf = (f: () => Promise<unknown>) =>
  f().then(
    () => "ok",
    (e: { code?: string; cause?: { code?: string } }) => e.code ?? e.cause?.code ?? "no-code",
  );
const T = { t1: tid(1), t2: tid(2), t3: tid(3), t4: tid(4), t5: tid(5), t6: tid(6), t7: tid(7) };
const ALL = Object.values(T);
const FACTS = [{}, { contractKind: "k1" }, { contractKind: "k2" }];
const lib = { A: "", B: "", C: "" };

let o: Sql;
let db: Db;

const mig = (f: string) =>
  readFileSync(
    new globalThis.URL(`../../../../../../packages/db/migrations-hub/${f}`, import.meta.url),
    "utf8",
  );
async function runMig(f: string) {
  for (const stmt of mig(f).split("--> statement-breakpoint"))
    if (stmt.trim()) await o.unsafe(stmt);
}

async function libCopy(key: string): Promise<string> {
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, description, input_hint,
      run_group_ids, stages, token_budget, enabled, sources, inputs, slot, slot_body, published_version)
    select null, ${key}, ${key}, description, input_hint, run_group_ids, stages, token_budget, enabled, sources, inputs,
      slot, slot_body, 1 from hub.process_defs where id = ${DFLT} returning id::text as id`;
  const id = r?.id as string;
  await o`insert into hub.process_def_releases (def_id, rel_version, name, stages, slot_body)
    select ${id}, 1, ${key}, stages, slot_body from hub.process_def_releases
    where def_id = ${DFLT} order by rel_version desc limit 1`;
  return id;
}

/** Bản sao nguyên văn câu tra CŨ (CR-105, trước cr120): gán cũ ⇒ mẫu khe ⇒ bản xuất bản. */
const OLD_RESOLVE = (t: string) => o<{ def_id: string; rel_version: number }[]>`
  select d.id::text as def_id, r.rel_version
  from (select
          (select a.def_id from hub.process_slot_assignments a where a.tenant_id = ${t}::uuid and a.slot = ${SLOT}) as a_id,
          (select s.default_def_id from hub.process_slots s where s.slot = ${SLOT}) as s_id) x
  join hub.process_defs d on d.id = coalesce(x.a_id, x.s_id) and d.deleted_at is null and d.slot = ${SLOT}
  join hub.process_def_releases r on r.def_id = d.id and r.rel_version = d.published_version`;

type Eff = { def: string | null; rel: number | null; blocked?: string };
const effOf = (r: { defId?: string; relVersion?: number; blocked?: string } | null): Eff =>
  !r
    ? { def: null, rel: null }
    : r.blocked
      ? { def: null, rel: null, blocked: r.blocked }
      : { def: r.defId ?? null, rel: r.relVersion ?? null };

/** Launch CŨ: có luật ⇒ `pickProcess` (người khởi tạo không phòng ban) ⇒ bản xuất bản của def luật; không luật ⇒ OLD_RESOLVE. */
async function oldRoute(t: string, facts: { contractKind?: string }): Promise<Eff> {
  const rules = (await o<
    RoutingRule[]
  >`select id::text as id, priority, condition, def_id::text as "defId",
      is_default as "isDefault" from hub.process_routing_rules where tenant_id = ${t} and slot = ${SLOT}`) as RoutingRule[];
  if (rules.length === 0) {
    const [r] = await OLD_RESOLVE(t);
    return r ? { def: r.def_id, rel: Number(r.rel_version) } : { def: null, rel: null };
  }
  const p = pickProcess(rules, [], facts);
  if (p.kind === "none") return { def: null, rel: null, blocked: "route_none" };
  const [d] = await o<{ rel: number }[]>`select rl.rel_version as rel from hub.process_defs d
    join hub.process_def_releases rl on rl.def_id = d.id and rl.rel_version = d.published_version
    where d.id = ${p.rule.defId} and d.deleted_at is null and d.slot = ${SLOT}`;
  return d
    ? { def: p.rule.defId, rel: Number(d.rel) }
    : { def: null, rel: null, blocked: "route_unavailable" };
}

async function rules(
  t: string,
  list: { prio: number; kinds?: string[]; def: string; dflt: boolean }[],
) {
  await o`insert into hub.process_routings (tenant_id, slot) values (${t}, ${SLOT})`;
  for (const r of list) {
    await o`insert into hub.process_tenant_defs (tenant_id, def_id, slot) values (${t}, ${r.def}, ${SLOT}) on conflict do nothing`;
    const cond = r.kinds ? { contractKinds: r.kinds } : {};
    await o`insert into hub.process_routing_rules (tenant_id, slot, priority, condition, def_id, is_default)
      values (${t}, ${SLOT}, ${r.prio}, ${JSON.stringify(cond)}::text::jsonb, ${r.def}, ${r.dflt})`;
  }
}

const snapshot = async (
  route: (t: string, f: { contractKind?: string }) => Promise<Eff>,
  resolve: (t: string) => Promise<Eff>,
) => {
  const out: Record<string, { route: Eff[]; resolve: Eff }> = {};
  for (const [k, t] of Object.entries(T))
    out[k] = { route: await Promise.all(FACTS.map((f) => route(t, f))), resolve: await resolve(t) };
  return out;
};
/** Loại đối tượng `hub.process_slot_assignments` (r = bảng, v = view, null = không còn). */
const relkind = async (): Promise<string | null> =>
  (
    await o<
      { k: string }[]
    >`select c.relkind::text as k from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'hub' and c.relname = 'process_slot_assignments'`
  )[0]?.k ?? null;
let before: Awaited<ReturnType<typeof snapshot>>;
const ruleRows = async () => [
  ...(await o`select tenant_id::text as t, priority, def_id::text as d, is_default from hub.process_routing_rules
    where tenant_id = any(${o.array(ALL)}::uuid[]) order by 1, 2`),
];

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  // Về trạng thái trước 0090/0091 (DB prod lúc deploy): bảng gán cũ là bảng, chưa có view.
  await o.unsafe(`drop view if exists hub.process_slot_assignments;
    alter table hub.process_slot_assignments_legacy rename to process_slot_assignments;
    grant select, insert, update, delete on hub.process_slot_assignments to hub_rw`);
  await runMig("0099_drop_slot_assign_view.sql"); // gặp BẢNG cùng tên (DB trước 0091) ⇒ không động tới (chỉ gỡ khi là VIEW)
  expect(await relkind()).toBe("r");
  await o`insert into admin.tenants (id, key, name) select t, 'ss' || right(t::text, 4), 'SS ' || right(t::text, 4)
    from unnest(${o.array(ALL)}::uuid[]) t`;
  await enablePack(
    o,
    ALL.filter((t) => t !== T.t5),
    "contracts",
  );
  await o`insert into hub.process_slots (slot, default_def_id) values (${SLOT}, ${DFLT})
    on conflict (slot) do update set default_def_id = excluded.default_def_id`;
  lib.A = await libCopy("ss-a");
  lib.B = await libCopy("ss-b");
  lib.C = await libCopy("ss-c");
  // t1 gán cũ A · t2 bật app, không gì · t3 gán cũ B + luật (k1 ⇒ C, mặc định A) · t4 gán cũ A + luật k1 ⇒ C (không mặc định)
  // · t5 không bật app · t6 gán cũ TƯỜNG MINH đúng mẫu khe · t7 bật app, tập {B} chưa có luật. (Gán cũ trỏ def đã xoá không xảy ra:
  // xoá def đang gán bị chặn PROCESS_IN_USE.)
  await o`insert into hub.process_slot_assignments (tenant_id, slot, def_id) values
    (${T.t1}, ${SLOT}, ${lib.A}), (${T.t3}, ${SLOT}, ${lib.B}), (${T.t4}, ${SLOT}, ${lib.A}), (${T.t6}, ${SLOT}, ${DFLT})`;
  await rules(T.t3 as string, [
    { prio: 0, kinds: ["k1"], def: lib.C, dflt: false },
    { prio: 1, def: lib.A, dflt: true },
  ]);
  await rules(T.t4 as string, [{ prio: 0, kinds: ["k1"], def: lib.C, dflt: false }]);
  await o`insert into hub.process_tenant_defs (tenant_id, def_id, slot) values (${T.t7}, ${lib.B}, ${SLOT})`;
  await runMig("0089_routing_backfill.sql"); // như prod: 0089 đã chạy trước 0090
  before = await snapshot(oldRoute, async (t) => {
    const [r] = await OLD_RESOLVE(t);
    return r ? { def: r.def_id, rel: Number(r.rel_version) } : { def: null, rel: null };
  });
  await runMig("0090_slot_default_rules.sql");
  await runMig("0091_slot_assign_view.sql");
  expect(await relkind()).toBe("v");
  await runMig("0099_drop_slot_assign_view.sql");
}, 180_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

const newRoute = async (t: string, f: { contractKind?: string }) =>
  effOf(await routeSlot(db, t, SLOT, userId(1399), f));
const newResolve = async (t: string) => effOf(await resolveSlot(db, t, SLOT));

describe("CR-120 · cr120-single-source · một nguồn gán", () => {
  it("ensureSlotDefaults (boot) cấp đúng tenant bật app chưa có luật, chạy lại vô hại", async () => {
    expect(await ensureSlotDefaults(db, SLOTS, ALL)).toBe(2); // t2, t7
    const rows = await ruleRows();
    expect(await ensureSlotDefaults(db, SLOTS, ALL)).toBe(0);
    await runMig("0090_slot_default_rules.sql");
    await runMig("0091_slot_assign_view.sql"); // dựng lại view (như DB mới chạy từ đầu) rồi 0099 gỡ lại
    await runMig("0099_drop_slot_assign_view.sql");
    await runMig("0099_drop_slot_assign_view.sql"); // chạy lại vô hại
    expect(await ruleRows()).toEqual(rows);
    const dflt = rows.filter((r) => r.is_default).map((r) => [r.t, r.d, r.priority]);
    expect(dflt).toEqual(
      [
        [T.t1, lib.A, 49],
        [T.t2, DFLT, 49],
        [T.t3, lib.A, 1], // luật có sẵn của tenant giữ nguyên
        [T.t6, DFLT, 49],
        [T.t7, DFLT, 49],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
  });

  it("launch không đổi cho mọi tenant × dữ kiện lượt, resolveSlot chỉ đổi ở tenant đã có luật (ghi rõ)", async () => {
    const after = await snapshot(newRoute, newResolve);
    for (const k of Object.keys(T))
      expect({ k, route: after[k]?.route }).toEqual({ k, route: before[k]?.route });
    const res = (s: typeof after) =>
      Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.resolve.def]));
    const { t3: a3, t4: a4, ...rest } = res(after);
    const { t3: b3, t4: b4, ...restBefore } = res(before);
    expect(rest).toEqual(restBefore);
    expect({ t3: [b3, a3], t4: [b4, a4] }).toEqual({ t3: [lib.B, lib.A], t4: [lib.A, DFLT] });
    // ca cụ thể (đọc được): t1 gán cũ, t2 mẫu, t3 luật k1, t5 không bật app vẫn chạy mẫu, t6 gán tường minh mẫu ⇒ "mặc định".
    expect(after.t1?.route[0]?.def).toBe(lib.A);
    expect(after.t2?.route[0]?.def).toBe(DFLT);
    expect(after.t3?.route[1]?.def).toBe(lib.C);
    expect(after.t4?.route[2]?.blocked).toBe("route_none"); // k2: không luật khớp, không mặc định
    expect(after.t5?.resolve.def).toBe(DFLT);
    expect(after.t6?.route[0]?.def).toBe(DFLT);
    expect((await resolveSlot(db, T.t6 as string, SLOT))?.isDefault).toBe(true);
    expect((await resolveSlot(db, T.t1 as string, SLOT))?.isDefault).toBe(false);
  });

  it("CR-121 A1 · hub 0099 gỡ VIEW process_slot_assignments, gán hiệu lực đọc từ luật mặc định, bảng _legacy không cấp cho hub_rw và còn dữ liệu cũ", async () => {
    expect(await relkind()).toBeNull();
    const legacy = await codeOf(() =>
      withHubScope(db, { kind: "system" }, (tx) =>
        tx.execute(sql`select 1 from hub.process_slot_assignments_legacy`),
      ),
    );
    const gone = await codeOf(() =>
      withHubScope(db, { kind: "system" }, (tx) =>
        tx.execute(sql`select 1 from hub.process_slot_assignments`),
      ),
    );
    expect({ legacy, gone }).toEqual({ legacy: "42501", gone: "42P01" });
    // nguồn mới thay view: luật mặc định ⋈ tập gán (đúng câu view cũ dẫn xuất) = {t1,t2,t3,t6,t7}
    const eff = await o`select r.tenant_id::text as t from hub.process_routing_rules r
      join hub.process_tenant_defs a on a.tenant_id = r.tenant_id and a.slot = r.slot and a.def_id = r.def_id
      where r.is_default and r.tenant_id = any(${o.array(ALL)}::uuid[]) order by 1`;
    expect(eff.map((r) => r.t)).toEqual([T.t1, T.t2, T.t3, T.t6, T.t7].sort());
    // dữ liệu cũ còn nguyên ở _legacy (đối chiếu một bản phát hành)
    expect(
      Number(
        (
          await o`select count(*)::int as n from hub.process_slot_assignments_legacy
      where tenant_id = any(${o.array(ALL)}::uuid[])`
        )[0]?.n,
      ),
    ).toBe(4);
  });

  it("danh sách thư viện: tenant_count = tập gán (process_tenant_defs), assignments kèm in_use theo luật", async () => {
    const ids = [lib.A, lib.B, lib.C];
    const [list, asgB, asgC, u] = await withHubScope(db, { kind: "system" }, async (tx) => [
      await listDefs(tx, {
        tenantId: null,
        library: true,
        includeTemplates: false,
        limit: 500,
        kind: "library",
      } as never),
      await listAssignments(tx, lib.B),
      await listAssignments(tx, lib.C),
      await usage(tx, lib.C),
    ]);
    const truth = Object.fromEntries(
      (
        await o<
          { d: string; n: number }[]
        >`select def_id::text as d, count(*)::int as n from hub.process_tenant_defs
        where def_id = any(${o.array(ids)}::uuid[]) group by 1`
      ).map((r) => [r.d, Number(r.n)]),
    );
    const shown = Object.fromEntries(
      (list as { id: string; tenant_count: number }[])
        .filter((r) => ids.includes(r.id))
        .map((r) => [r.id, Number(r.tenant_count)]),
    );
    expect(shown).toEqual(truth);
    expect(truth).toEqual({ [lib.A]: 3, [lib.B]: 2, [lib.C]: 2 }); // A: t1,t3,t4 · B: t3 (0089), t7 · C: t3,t4
    const flags = (rows: typeof asgB) => rows.map((r) => [r.tenant_id, r.in_use]);
    expect(flags(asgC)).toEqual(
      [
        [T.t3, true],
        [T.t4, true],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
    expect(flags(asgB).every(([, used]) => used === false)).toBe(true);
    expect(u.tenant_count).toBe(2); // PROCESS_IN_USE theo cùng nguồn
  });

  it("resolveSlot/routeSlot chỉ đọc nguồn mới (không còn đối tượng process_slot_assignments)", async () => {
    expect(await relkind()).toBeNull();
    expect((await newResolve(T.t1 as string)).def).toBe(lib.A);
    expect((await newRoute(T.t3 as string, { contractKind: "k1" })).def).toBe(lib.C);
  });
});
