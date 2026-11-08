// CR-122 · E2b · đường thật (role `hub_api`, scope system, tx khoá run): node Duyệt rẽ theo field `decision` (Duyệt ⇒ bước kế,
// Từ chối ⇒ `reject_step`, Trả lại ⇒ `return_step`); lượt đã huỷ + kết quả/sự kiện tới muộn ⇒ join bước không chạy, giữ
// `cancelled`, không gọi OutcomeHandler.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Db, Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { registerOutcomeHandler, unregisterFlowPorts } from "./flow-ports";
import { settleStepTx } from "./step.repo";

const PACK = "e2btest";
const EVENT = "e2btest.submitted";
let o: Sql;
let db: Db;
let close: () => Promise<void>;
let tid = "";
let uid = "";
let defId = "";
const applied: string[] = [];

/** 0 agent · 1 Duyệt (Từ chối→3, Trả lại→4) · 2 Kết thúc approved · 3 Kết thúc rejected · 4 Kết thúc returned. */
const SNAP = {
  key: "e2b",
  name: "E2b",
  trigger: { event: EVENT },
  stages: [
    { key: "a", step: 0, executor: { kind: "agent" } },
    { key: "ok", step: 1, executor: { kind: "approve", reject_step: 3, return_step: 4 } },
    { key: "end_ok", step: 2, executor: { kind: "set" }, outcome: "approved" },
    { key: "end_no", step: 3, executor: { kind: "set" }, outcome: "rejected" },
    { key: "end_back", step: 4, executor: { kind: "set" }, outcome: "returned" },
  ],
};

/** Mẫu Thư viện: bước Duyệt mang `after: { kind: "review", branch: [] }` (không luật rẽ tự đặt). */
const SNAP_EMPTY_BRANCH = {
  ...SNAP,
  stages: SNAP.stages.map((s) =>
    s.key === "ok" ? { ...s, after: { kind: "review", branch: [] as never[] } } : s,
  ),
};

async function seedRun(o2: {
  step: number;
  st: string[];
  status?: string;
  decision?: string;
  snap?: unknown;
}) {
  const [c] = await o<
    { id: string }[]
  >`insert into hub.conversations (tenant_id, user_id, title, title_norm)
    values (${tid}, ${uid}, 'c', 'c') returning id`;
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_runs (tenant_id, process_def_id, def_version,
      snapshot, started_by, origin_kind, input, conversation_id, flow_id, current_step, current_stage_idx,
      pack_key, pack_record_id, status)
    values (${tid}, ${defId}, 1, ${o.json((o2.snap ?? SNAP) as never)}, ${uid}, 'admin', 'x', ${c?.id as string},
      gen_random_uuid(), ${o2.step}, ${o2.step}, ${PACK}, gen_random_uuid(), ${o2.status ?? "running"}) returning id`;
  const runId = r?.id as string;
  for (const [i, s] of o2.st.entries()) {
    const [sr] = await o<
      { id: string }[]
    >`insert into hub.stage_runs (tenant_id, process_run_id, stage_idx, status)
      values (${tid}, ${runId}, ${i}, ${s}) returning id`;
    if (i === 1 && o2.decision) {
      const [out] = await o<
        { id: string }[]
      >`insert into hub.process_outputs (tenant_id, process_run_id,
          stage_run_id, stage_idx, version, attempt, content, template_ok, fields)
        values (${tid}, ${runId}, ${sr?.id as string}, 1, 1, 1, '# Duyệt', true,
          ${o.json({ decision: o2.decision } as never)}) returning id`;
      await o`update hub.stage_runs set current_output_id = ${out?.id as string} where id = ${sr?.id as string}`;
    }
  }
  return runId;
}

const settle = (runId: string) =>
  withHubScope(db, { kind: "system" }, (tx: Tx) => settleStepTx(tx, runId, tid));
const stagesOf = async (runId: string) =>
  (
    await o<{ status: string }[]>`select status from hub.stage_runs where process_run_id = ${runId}
      order by stage_idx`
  ).map((r) => r.status);

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  const [t] = (await tenants(o, 1, 1221)) as [string];
  tid = t;
  uid = (await users(o, tid, 1, { from: 122_100 }))[0] as string;
  const [d] = await o<{ id: string }[]>`insert into hub.process_defs (tenant_id, key, name, stages)
    values (${tid}, 'e2b', 'e2b', ${o.json([{ key: "a" }])}) returning id`;
  defId = d?.id as string;
  const client = postgres(urls().hubApi, { max: 2, onnotice: () => {} });
  db = { db: drizzle(client), max: 2, close: () => client.end() } as unknown as Db;
  close = () => client.end({ timeout: 2 });
  registerOutcomeHandler({
    packKey: PACK,
    events: [EVENT],
    async apply(_tx, input) {
      applied.push(`${input.runId}:${input.outcome}`);
      return "applied";
    },
  });
}, 300_000);
afterAll(async () => {
  unregisterFlowPorts(PACK);
  await close?.();
  await o?.end({ timeout: 2 });
});

const DONE_AT_APPROVE = ["done", "done", "pending", "pending", "pending"];

describe("CR-122 · E2b · node Duyệt rẽ theo quyết định (đường thật)", () => {
  it("Duyệt ⇒ bước kế (Kết thúc · Đã duyệt)", async () => {
    const runId = await seedRun({ step: 1, st: DONE_AT_APPROVE, decision: "approved" });
    expect((await settle(runId))?.step).toBe(2);
  });
  it("Từ chối ⇒ reject_step (bước 2 skipped)", async () => {
    const runId = await seedRun({ step: 1, st: DONE_AT_APPROVE, decision: "rejected" });
    expect((await settle(runId))?.step).toBe(3);
    expect(await stagesOf(runId)).toEqual(["done", "done", "skipped", "queued", "pending"]);
  });
  it("Trả lại ⇒ return_step", async () => {
    const runId = await seedRun({ step: 1, st: DONE_AT_APPROVE, decision: "returned" });
    expect((await settle(runId))?.step).toBe(4);
  });
  it("Trả lại / Từ chối ⇒ đích của node Duyệt kể cả khi `after.branch` rỗng (mẫu Thư viện)", async () => {
    const back = await seedRun({
      step: 1,
      st: DONE_AT_APPROVE,
      decision: "returned",
      snap: SNAP_EMPTY_BRANCH,
    });
    expect((await settle(back))?.step).toBe(4);
    const no = await seedRun({
      step: 1,
      st: DONE_AT_APPROVE,
      decision: "rejected",
      snap: SNAP_EMPTY_BRANCH,
    });
    expect((await settle(no))?.step).toBe(3);
  });
});

describe("CR-122 · E2b · node Duyệt · Kết thúc, lượt huỷ", () => {
  it("Từ chối rẽ tới Kết thúc khi hẹn còn mở ⇒ hẹn của nhánh bị bỏ và nhánh sau Kết thúc bị huỷ", async () => {
    const runId = await seedRun({ step: 1, st: DONE_AT_APPROVE, decision: "rejected" });
    const ids = await o<
      { id: string; stage_idx: number }[]
    >`select id, stage_idx from hub.stage_runs
      where process_run_id = ${runId} order by stage_idx`;
    const due = new Date(Date.now() + 86_400_000).toISOString();
    // Hẹn mở (nhắc/chuyển cấp/thử lại) trên nhánh Đã duyệt (bước 2) và nhánh Trả lại (bước 4, sau Kết thúc · Từ chối).
    for (const i of [2, 4])
      await o`insert into hub.process_timers (tenant_id, process_run_id, stage_run_id, kind, due_at, idempotency_key)
        values (${tid}, ${runId}, ${ids[i]?.id as string}, 'retry', ${due}, ${`e3b:${runId}:${i}`})`;
    expect((await settle(runId))?.step).toBe(3);
    await o`update hub.stage_runs set status = 'done' where process_run_id = ${runId} and stage_idx = 3`;
    expect((await settle(runId))?.kind).toBe("finish");
    const open = await o<{ n: number }[]>`select count(*)::int as n from hub.process_timers
      where process_run_id = ${runId} and cancelled_at is null and fired_at is null`;
    expect(open[0]?.n).toBe(0);
    expect(await stagesOf(runId)).toEqual(["done", "done", "skipped", "done", "skipped"]);
    expect(applied).toContain(`${runId}:rejected`);
  });

  it("lượt đã huỷ, kết quả tới muộn ⇒ vẫn cancelled, handler không bị gọi", async () => {
    const runId = await seedRun({
      step: 2,
      st: ["done", "done", "done", "pending", "pending"],
      status: "cancelled",
    });
    expect(await settle(runId)).toBeNull();
    const [r] = await o<
      { status: string }[]
    >`select status from hub.process_runs where id = ${runId}`;
    expect(r?.status).toBe("cancelled");
    expect(applied.some((x) => x.startsWith(runId))).toBe(false);
  });
});
