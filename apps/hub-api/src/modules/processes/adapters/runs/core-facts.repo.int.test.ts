// CR-160 · «Người gửi là cấp cao nhất» (`starter_is_top`) — int (DB thật, role `hub_api`, scope system, tx khoá run): câu đọc dữ kiện lõi
// theo người bắt đầu lượt + cây phòng (trưởng gốc ⇒ Đúng; trưởng phòng con / thành viên gốc không phải trưởng ⇒ Sai; tenant khác không rò;
// trưởng gốc bị khoá vẫn Đúng) và MỘT lượt chạy thật bắt đầu bằng phiếu (không bản ghi app): node Nếu rẽ bỏ bước duyệt.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Db, Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { department, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { readCoreFacts } from "./core-facts.repo";
import { settleStepTx } from "./step.repo";

let o: Sql;
let db: Db;
let close: () => Promise<void>;
let T = "";
let T2 = "";
let defId = "";
// Gốc (head ROOT; members ROOT, NGAN) ← phòng con (head CHILD). X, OTHER: người tenant 2 (OTHER = trưởng gốc tenant 2).
let ROOT = "";
let NGAN = "";
let CHILD = "";
let X = "";
let OTHER = "";

const IF = {
  kind: "if",
  when: {
    op: "and",
    conds: [{ from: { kind: "fact", key: "starter_is_top" }, op: "eq", value: true }],
  },
  then_step: 3,
  else_step: 2,
};
/** 0 phiếu · 1 Nếu(người gửi là cấp cao nhất: Đúng→3, Sai→2) · 2 Duyệt · 3 Ghi đã chi. Lượt bắt đầu bằng phiếu: KHÔNG có bản ghi app. */
const SNAP = {
  key: "ph",
  name: "Phiếu",
  trigger: { event: "contract.submitted" },
  stages: [
    { key: "phieu", step: 0, executor: { kind: "set" } },
    { key: "re", step: 1, executor: IF },
    { key: "duyet", step: 2, executor: { kind: "set" } },
    { key: "chi", step: 3, executor: { kind: "set" } },
  ],
};

async function seedRun(tenant: string, startedBy: string, withStages = false) {
  const [c] = await o<
    { id: string }[]
  >`insert into hub.conversations (tenant_id, user_id, title, title_norm)
    values (${tenant}, ${startedBy}, 'c', 'c') returning id`;
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_runs (tenant_id, process_def_id, def_version,
      snapshot, started_by, origin_kind, input, conversation_id, flow_id, current_step, current_stage_idx)
    values (${tenant}, ${defId}, 1, ${o.json(SNAP as never)}, ${startedBy}, 'admin', 'x', ${c?.id as string},
      gen_random_uuid(), 1, 1) returning id`;
  const runId = r?.id as string;
  if (withStages)
    for (const [i, s] of ["done", "done", "pending", "pending"].entries())
      await o`insert into hub.stage_runs (tenant_id, process_run_id, stage_idx, status)
        values (${tenant}, ${runId}, ${i}, ${s})`;
  return runId;
}
const read = (tenant: string, runId: string) =>
  withHubScope(db, { kind: "system" }, (tx: Tx) =>
    readCoreFacts(tx, tenant, runId, ["starter_is_top"]),
  );
const settle = (runId: string) =>
  withHubScope(db, { kind: "system" }, (tx: Tx) => settleStepTx(tx, runId, T));

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [T, T2] = (await tenants(o, 2, 1600)) as [string, string];
  [ROOT, NGAN, CHILD] = (await users(o, T, 3, { from: 160_000 })) as [string, string, string];
  [X, OTHER] = (await users(o, T2, 2, { from: 160_100 })) as [string, string];
  const root = await department(o, T, "ct-goc", { head: ROOT, members: [ROOT, NGAN] });
  const child = await department(o, T, "ct-con", { head: CHILD, members: [CHILD] });
  await o`update admin.departments set parent_group_id = ${root} where group_id = ${child}`;
  await department(o, T2, "ct2-goc", { head: OTHER, members: [OTHER, X] });
  const [d] = await o<{ id: string }[]>`insert into hub.process_defs (tenant_id, key, name, stages)
    values (${T}, 'ct-160', 'ct', ${o.json([{ key: "a" }])}) returning id`;
  defId = d?.id as string;
  const client = postgres(urls().hubApi, { max: 2, onnotice: () => {} });
  db = { db: drizzle(client), max: 2, close: () => client.end() } as unknown as Db;
  close = () => client.end({ timeout: 2 });
}, 300_000);
afterAll(async () => {
  await close?.();
  await o?.end({ timeout: 2 });
});

describe("CR-160 · câu đọc starter_is_top", () => {
  it("trưởng phòng gốc gửi ⇒ Đúng", async () => {
    expect(await read(T, await seedRun(T, ROOT))).toEqual({ starter_is_top: true });
  });
  it("trưởng phòng con gửi ⇒ Sai", async () => {
    expect(await read(T, await seedRun(T, CHILD))).toEqual({ starter_is_top: false });
  });
  it("thành viên phòng gốc không phải trưởng (Ngân) ⇒ Sai", async () => {
    expect(await read(T, await seedRun(T, NGAN))).toEqual({ starter_is_top: false });
  });
  it("tenant khác không rò: không đọc lượt của tenant khác, mỗi tenant chỉ so với cây phòng của mình", async () => {
    const runT = await seedRun(T, ROOT);
    expect(await read(T2, runT)).toBeNull();
    const runX = await seedRun(T2, X);
    expect(await read(T2, runX)).toEqual({ starter_is_top: false });
    expect(await read(T2, await seedRun(T2, OTHER))).toEqual({ starter_is_top: true });
    expect(await read(T, runX)).toBeNull();
  });
  it("trưởng gốc bị khoá vẫn là trưởng gốc, người khác vẫn Sai (Quyết định: hỏi ai đứng đầu sơ đồ, không xét còn dùng được)", async () => {
    await o`update admin.users set locked_by_tenant = true where id = ${ROOT}`;
    expect(await read(T, await seedRun(T, ROOT))).toEqual({ starter_is_top: true });
    expect(await read(T, await seedRun(T, NGAN))).toEqual({ starter_is_top: false });
    await o`update admin.users set locked_by_tenant = false where id = ${ROOT}`;
  });
  it("không có khoá lõi nào được hỏi ⇒ không chạy câu nào (null)", async () => {
    expect(
      await withHubScope(db, { kind: "system" }, (tx: Tx) => readCoreFacts(tx, T, "x", [])),
    ).toBeNull();
  });
});

describe("CR-160 · lượt bắt đầu bằng phiếu: node Nếu rẽ theo starter_is_top", () => {
  type Summary = { facts?: { matched: boolean; reads: { key: string; value: unknown }[] } };
  const branch = async (runId: string) =>
    (
      await o<{ summary: Summary }[]>`select summary from hub.audit_log
        where entity_id = ${runId} and action = 'branch'`
    )[0]?.summary.facts;

  it("trưởng gốc bắt đầu ⇒ Nếu Đúng ⇒ bỏ bước Duyệt, tới Ghi đã chi, lịch sử ghi giá trị đã đọc", async () => {
    const runId = await seedRun(T, ROOT, true);
    const out = await settle(runId);
    expect(out?.step).toBe(3);
    expect(await branch(runId)).toEqual({
      matched: true,
      reads: [{ key: "starter_is_top", value: true }],
    });
    const st = await o<{ status: string }[]>`select status from hub.stage_runs
      where process_run_id = ${runId} order by stage_idx`;
    expect(st[2]?.status).toBe("skipped");
  });
  it("Ngân (không phải trưởng) bắt đầu ⇒ Nếu Sai ⇒ vào bước Duyệt", async () => {
    const runId = await seedRun(T, NGAN, true);
    const out = await settle(runId);
    expect(out?.step).toBe(2);
    expect(await branch(runId)).toMatchObject({ matched: false });
  });
});
