// CR-116 B3 · B5 · làn đầy đủ (definer/RLS) — viết TRƯỚC code. Đường thật: role `hub_api` + `withHubScope`; dữ liệu dựng
// bằng owner. B3: `runRecipientsMany` (definer theo tập 0088) cho kết quả GIỐNG HỆT `runRecipients` (definer 0020) từng run
// trên 2 tenant × nhiều user/phòng/group/task, ở mọi scope; cách ly tenant; số câu lô N → 1; `systemEach` hẹn giờ phát cùng
// sự kiện với đường từng hàng nhưng 1 câu người nhận. B5: `lockHead` + `stageSourceCtxOf` = đầu run + nguồn cũ, 1 câu, có khoá.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Db, Tx } from "@ai/db";
import { type HubScope, withHubScope } from "@ai/db/hub-scope";
import { groups, members, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createHubUow } from "../adapters/hub-uow";
import type { OutboxEvent } from "../application/ports";
import { lockHead } from "../runs/stage-driver";
import { loadStageSourceCtx, stageSourceCtxOf } from "../runs/stage-sources";
import { headOf } from "../runs/team-runner";
import * as core from "./core.repo";

type Run = { id: string; tenantId: string; stageId: string };
type Ten = { id: string; users: string[]; runs: Run[] };
let o: Sql;
let db: Db;
let close: () => Promise<void>;
const queries: string[] = [];
const T: Record<"a" | "b", Ten> = {
  a: { id: "", users: [], runs: [] },
  b: { id: "", users: [], runs: [] },
};

/** Pool `hub_api` có hook đếm câu (`debug`) — cùng drizzle như app. */
function openDb(): void {
  const client = postgres(urls().hubApi, {
    max: 2,
    onnotice: () => {},
    debug: (_c, q) => void queries.push(q),
  });
  db = { db: drizzle(client), max: 2, close: () => client.end() } as unknown as Db;
  close = () => client.end({ timeout: 2 });
}

async function seedTenant(t: Ten, n: number): Promise<void> {
  const [tid] = (await tenants(o, 1, n)) as [string];
  t.id = tid;
  t.users = await users(o, tid, 10, { from: n * 100 });
  const u = t.users as string[];
  const g = (await groups(o, tid, ["cr116-g"])).get("cr116-g") as string;
  await members(o, tid, g, [u[6] as string, u[7] as string]);
  const [room] = await o<
    { id: string }[]
  >`insert into hub.rooms (id, tenant_id, kind, name, last_activity_at,
      created_by, created_at) values (gen_random_uuid(), ${tid}, 'group', 'cr116', now(), ${u[0] as string}, now())
    returning id`;
  const rid = room?.id as string;
  await o`insert into hub.room_members (room_id, tenant_id, user_id, role, joined_at, left_at) values
    (${rid}, ${tid}, ${u[0] as string}, 'owner', now(), null), (${rid}, ${tid}, ${u[1] as string}, 'member', now(), null),
    (${rid}, ${tid}, ${u[2] as string}, 'member', now(), now())`;
  const snap = {
    stages: [{ key: "s0", sources: [{ source_key: "k1", allowlist: ["a"] }] }, { key: "s1" }],
    sources: [
      { key: "k1", kind: "url", source_id: "x", config: {}, description: "d", allowlist_union: [] },
    ],
    token_budget: null,
  };
  const [d] = await o<{ id: string }[]>`insert into hub.process_defs (tenant_id, key, name, stages)
    values (${tid}, 'cr116', 'cr116', ${o.json([{ key: "s0" }])}) returning id`;
  // 0 admin · 1 phòng · 2 phòng + task mở (user + group) · 3 task đóng (u5) + task mở group · 4 task mở user + chuyển tiếp
  for (let k = 0; k < 5; k++) await seedRun({ t, u, g, rid, def: d?.id as string, snap }, k);
}

type RunCtx = { t: Ten; u: string[]; g: string; rid: string; def: string; snap: object };
async function seedRun(x: RunCtx, k: number): Promise<void> {
  const { t, u, g } = x;
  const tid = t.id;
  const room = k === 1 || k === 2;
  const [c] = await o<
    { id: string }[]
  >`insert into hub.conversations (tenant_id, user_id, title, title_norm)
    values (${tid}, ${u[0] as string}, 'c', 'c') returning id`;
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_runs (tenant_id, process_def_id, def_version,
      snapshot, started_by, origin_kind, origin_room_id, input, conversation_id, flow_id, pinned_sources)
    values (${tid}, ${x.def}, 1, ${o.json(x.snap as never)}, ${u[k % 2 === 0 ? 3 : 4] as string},
      ${room ? "room" : "admin"}, ${room ? x.rid : null}, 'x', ${c?.id as string}, gen_random_uuid(),
      ${k === 0 ? o.json([{ ref: "v1" }]) : null}) returning id`;
  const runId = r?.id as string;
  const stages = await o<
    { id: string }[]
  >`insert into hub.stage_runs (tenant_id, process_run_id, stage_idx)
    select ${tid}, ${runId}, i from generate_series(0, 2) i returning id`;
  t.runs.push({ id: runId, tenantId: tid, stageId: stages[0]?.id as string });
  const task = async (si: number, status: string, group: string | null, who: string[]) => {
    const [tk] = await o<
      { id: string }[]
    >`insert into hub.review_tasks (tenant_id, process_run_id, stage_run_id,
        kind, status, question, assignee_group_id, result) values (${tid}, ${runId}, ${stages[si]?.id as string},
        'ask', ${status}, 'q', ${group}, ${status === "closed" ? "cancelled" : null}) returning id`;
    for (const [i, w] of who.entries())
      await o`insert into hub.review_task_assignees (tenant_id, task_id, user_id, via, depth)
        values (${tid}, ${tk?.id as string}, ${w}, ${i === 0 ? "initial" : "forward"}, ${i})`;
  };
  if (k === 2) await task(0, "open", g, [u[8] as string]);
  if (k === 3) {
    await task(0, "closed", null, [u[5] as string]);
    await task(1, "open", g, []);
  }
  if (k === 4) await task(0, "open", null, [u[8] as string, u[9] as string]);
}
beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  await seedTenant(T.a, 1161);
  await seedTenant(T.b, 1162);
  openDb();
}, 300_000);
afterAll(async () => {
  await close?.();
  await o?.end({ timeout: 2 });
});

const all = () => [...T.a.runs, ...T.b.runs];
const sys: HubScope = { kind: "system" };
const userOf = (t: Ten): HubScope => ({
  kind: "user",
  tenantId: t.id,
  userId: t.users[0] as string,
});
const sorted = (xs: readonly string[]) => [...xs].sort();
const inScope = <R>(s: HubScope, fn: (tx: Tx) => Promise<R>) => withHubScope(db, s, fn);

async function oldPath(s: HubScope, runs: readonly { id: string; tenantId: string }[]) {
  return inScope(s, async (tx) => {
    const out: Record<string, string[]> = {};
    for (const r of runs) out[r.id] = sorted(await core.runRecipients(tx, r.id, r.tenantId));
    return out;
  });
}
async function newPath(s: HubScope, runs: readonly { id: string; tenantId: string }[]) {
  return inScope(s, async (tx) => {
    const m = await core.runRecipientsMany(
      tx,
      runs.map((r) => ({ runId: r.id, tenantId: r.tenantId })),
    );
    return Object.fromEntries(runs.map((r) => [r.id, sorted(m.get(r.id) ?? [])]));
  });
}
const recipCalls = () => queries.filter((q) => /process_runs?_recipients/.test(q)).length;

describe("CR-116 B3 · người nhận process.updated theo tập", () => {
  it("giống hệt definer từng run: 2 tenant × 5 dạng run, scope system / user A / user B", async () => {
    for (const s of [sys, userOf(T.a), userOf(T.b)])
      expect(await newPath(s, all())).toEqual(await oldPath(s, all()));
    // Kiểm dữ liệu mẫu đủ nhánh (không phải so rỗng = rỗng).
    const u = T.a.users;
    const r = T.a.runs.map((x) => x.id);
    const got = await newPath(sys, T.a.runs);
    expect(got[r[0] as string]).toEqual(sorted([u[3] as string]));
    expect(got[r[1] as string]).toEqual(sorted([u[4], u[0], u[1]] as string[]));
    expect(got[r[2] as string]).toEqual(sorted([u[3], u[0], u[1], u[8], u[6], u[7]] as string[]));
    expect(got[r[3] as string]).toEqual(sorted([u[4], u[6], u[7]] as string[]));
    expect(got[r[4] as string]).toEqual(sorted([u[3], u[8], u[9]] as string[]));
  });

  it("cách ly tenant: cặp (run, tenant lệch), user tenant khác, không scope ⇒ rỗng", async () => {
    const swapped = T.a.runs.map((r) => ({ id: r.id, tenantId: T.b.id }));
    const none = Object.fromEntries(all().map((r) => [r.id, [] as string[]]));
    expect(await newPath(sys, swapped)).toEqual(Object.fromEntries(swapped.map((r) => [r.id, []])));
    const bSeesA = await newPath(userOf(T.b), T.a.runs);
    expect(Object.values(bSeesA).flat()).toEqual([]);
    // user B tự khai tenant A cho run của A (GUC vẫn B) ⇒ rỗng như đường cũ.
    expect(await newPath(userOf(T.b), T.a.runs)).toEqual(await oldPath(userOf(T.b), T.a.runs));
    // Không scope (ngoài withHubScope) ⇒ rỗng.
    const raw = await db.db.transaction(async (tx) =>
      core.runRecipientsMany(
        tx as unknown as Tx,
        all().map((r) => ({ runId: r.id, tenantId: r.tenantId })),
      ),
    );
    expect(Object.fromEntries(raw)).toEqual(none);
  });

  it("số câu người nhận mỗi lô: N câu (definer từng run) → 1 câu, lô rỗng 0 câu", async () => {
    const runs = all();
    queries.length = 0;
    await oldPath(sys, runs);
    const before = recipCalls();
    queries.length = 0;
    await newPath(sys, runs);
    const after = recipCalls();
    queries.length = 0;
    await newPath(sys, []);
    expect({ before, after, empty: recipCalls() }).toEqual({
      before: runs.length,
      after: 1,
      empty: 0,
    });
  });

  it("systemEach hẹn giờ (requeue): cùng sự kiện như đường từng hàng, 1 câu người nhận cho cả lô", async () => {
    const pub: OutboxEvent[][] = [];
    const uow = createHubUow(db, {
      clock: { now: () => new Date() },
      publish: async (e) => void pub.push([...e]),
    });
    const runs = all();
    const now = new Date();
    for (const r of runs)
      await uow.system(r.tenantId, (x) => x.stageTimers.requeue(r.id, r.stageId, now));
    const single = pub.splice(0).flat();
    queries.length = 0;
    await uow.systemEach(
      async () => runs,
      (r) => r.tenantId,
      (x, r) => x.stageTimers.requeue(r.id, r.stageId, now),
    );
    const batch = pub.splice(0).flat();
    // `userIds` là TẬP người nhận (fan-out tới từng người): thứ tự trong mảng do SQL (DISTINCT/UNION) không xác định ở cả hai
    // đường ⇒ so sánh đã sắp xếp; thứ tự SỰ KIỆN và nội dung còn lại vẫn so nguyên.
    const flat = (es: OutboxEvent[]) =>
      es
        .flatMap((e): readonly unknown[] => (e.kind === "user_events" ? e.events : [e]))
        .map((e) => {
          const ev = e as { userIds?: string[] };
          return Array.isArray(ev.userIds) ? { ...ev, userIds: sorted(ev.userIds) } : ev;
        });
    expect(flat(batch)).toEqual(flat(single));
    // requeue phát đúng 1 `process.updated` mỗi run (mọi run có `started_by` ⇒ có người nhận) — không rỗng = rỗng.
    const got = flat(batch) as { event?: string; userIds?: string[] }[];
    expect(got.length).toBe(runs.length);
    for (const e of got) {
      expect(e.event).toBe("process.updated");
      expect((e.userIds ?? []).length).toBeGreaterThan(0);
    }
    expect(recipCalls()).toBe(1);
  });
});

describe("CR-116 B5 · khoá + đầu run + nguồn một câu", () => {
  it("lockHead + stageSourceCtxOf = headOf + loadStageSourceCtx (mọi idx, có/không ghim), 1 câu thay 4, giữ khoá", async () => {
    for (const r of all())
      for (const idx of [0, 1, 5]) {
        const want = await inScope(sys, async (tx) => ({
          head: await headOf(tx, r.id),
          src: await loadStageSourceCtx(tx, r.id, idx),
        }));
        const got = await inScope(sys, async (tx) => {
          const h = await lockHead(tx, r.id);
          const { pinned_sources, ...head } = h ?? { pinned_sources: null };
          return { head, src: stageSourceCtxOf(h?.snapshot, pinned_sources, idx) };
        });
        expect(got as unknown).toEqual(want);
      }
    const r0 = T.a.runs[0] as Run;
    queries.length = 0;
    const locked = await inScope(sys, async (tx) => {
      await lockHead(tx, r0.id);
      // Hàng đã khoá: kết nối khác `for update nowait` ⇒ 55P03.
      return o`select 1 from hub.process_runs where id = ${r0.id} for update nowait`.then(
        () => "free",
        (e: { code?: string }) => e.code,
      );
    });
    const reads = queries.filter((q) => /from hub\.process_runs|"process_runs"/.test(q)).length;
    expect({ locked, reads }).toEqual({ locked: "55P03", reads: 1 });
  });
});
