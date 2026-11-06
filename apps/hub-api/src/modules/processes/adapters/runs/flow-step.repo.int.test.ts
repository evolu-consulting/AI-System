// CR-122 · E2 · FLOW2-FR-12/15 · H2 · đường thật (role `hub_api`, scope system, tx khoá run): node Nếu đọc dữ kiện app qua
// `FactsReader` + ghi lịch sử giá trị đã đọc (audit `branch.facts`); node Kết thúc gọi `OutcomeHandler` CÙNG tx (rollback cùng
// nhau), idempotent khi gọi lại; dữ kiện đổi sau khi rẽ ⇒ "Cần xử lý" (needs_decision, không gọi handler).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Db, Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { FlowFacts, OutcomeInput } from "../../../packs/kit/public";
import { registerFactsReader, registerOutcomeHandler, unregisterFlowPorts } from "./flow-ports";
import { settleStepTx } from "./step.repo";

const PACK = "e2test";
const EVENT = "e2test.submitted";
let o: Sql;
let db: Db;
let close: () => Promise<void>;
let tid = "";
let uid = "";
let defId = "";
let facts: FlowFacts = {};
const reads: string[][] = [];
const applied: OutcomeInput[] = [];
const seen = new Set<string>();
let failNext = false;

const IF = {
  kind: "if",
  when: { op: "and", conds: [{ from: { kind: "fact", key: "value" }, op: "gt", value: 100 }] },
  then_step: 2,
  else_step: 3,
};
/** 0 agent · 1 Nếu(value > 100: Đúng→2, Sai→3) · 2 Kết thúc approved · 3 Kết thúc rejected. */
const SNAP = {
  key: "e2",
  name: "E2",
  trigger: { event: EVENT },
  stages: [
    { key: "a", step: 0, executor: { kind: "agent" } },
    { key: "if1", step: 1, executor: IF },
    { key: "ok", step: 2, executor: { kind: "set" }, outcome: "approved" },
    { key: "no", step: 3, executor: { kind: "set" }, outcome: "rejected" },
  ],
};

async function seedRun(step: number, st: string[]): Promise<string> {
  const [c] = await o<
    { id: string }[]
  >`insert into hub.conversations (tenant_id, user_id, title, title_norm)
    values (${tid}, ${uid}, 'c', 'c') returning id`;
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_runs (tenant_id, process_def_id, def_version,
      snapshot, started_by, origin_kind, input, conversation_id, flow_id, current_step, current_stage_idx,
      pack_key, pack_record_id)
    values (${tid}, ${defId}, 1, ${o.json(SNAP as never)}, ${uid}, 'admin', 'x', ${c?.id as string},
      gen_random_uuid(), ${step}, ${step}, ${PACK}, gen_random_uuid()) returning id`;
  const runId = r?.id as string;
  for (const [i, s] of st.entries())
    await o`insert into hub.stage_runs (tenant_id, process_run_id, stage_idx, status)
      values (${tid}, ${runId}, ${i}, ${s})`;
  return runId;
}

const settle = (runId: string) =>
  withHubScope(db, { kind: "system" }, (tx: Tx) => settleStepTx(tx, runId, tid));
const runOf = async (runId: string) =>
  (
    await o<{ status: string; decision: { reason?: string; stage_idx?: number } | null }[]>`
      select status, decision from hub.process_runs where id = ${runId}`
  )[0];
const stagesOf = async (runId: string) =>
  (
    await o<{ status: string }[]>`select status from hub.stage_runs where process_run_id = ${runId}
      order by stage_idx`
  ).map((r) => r.status);

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  const [t] = (await tenants(o, 1, 1220)) as [string];
  tid = t;
  uid = (await users(o, tid, 1, { from: 122_000 }))[0] as string;
  const [d] = await o<{ id: string }[]>`insert into hub.process_defs (tenant_id, key, name, stages)
    values (${tid}, 'e2', 'e2', ${o.json([{ key: "a" }])}) returning id`;
  defId = d?.id as string;
  const client = postgres(urls().hubApi, { max: 2, onnotice: () => {} });
  db = { db: drizzle(client), max: 2, close: () => client.end() } as unknown as Db;
  close = () => client.end({ timeout: 2 });
  registerFactsReader({
    packKey: PACK,
    events: [EVENT],
    read: async (_t, _ref, keys) => {
      reads.push([...keys]);
      return facts;
    },
  });
  registerOutcomeHandler({
    packKey: PACK,
    events: [EVENT],
    async apply(tx, input) {
      // Ghi CÙNG tx engine: đọc lại trạng thái run thấy hàng đang khoá của chính tx này.
      await tx.execute(sql`select 1 from hub.process_runs where id = ${input.runId}`);
      if (failNext) {
        failNext = false;
        throw new Error("app lỗi");
      }
      const k = `${input.runId}:${input.outcome}`;
      if (seen.has(k)) return "already_applied";
      seen.add(k);
      applied.push(input);
      return "applied";
    },
  });
}, 300_000);
afterAll(async () => {
  unregisterFlowPorts(PACK);
  await close?.();
  await o?.end({ timeout: 2 });
});

describe("CR-122 · E2 · node Nếu dữ kiện + Kết thúc (đường thật)", () => {
  it("Nếu đọc giá trị hiện tại (150 > 100 ⇒ Đúng), ghi giá trị đã đọc vào lịch sử, Sai-nhánh skipped", async () => {
    facts = { value: 150 };
    reads.length = 0;
    const runId = await seedRun(1, ["done", "done", "pending", "pending"]);
    const out = await settle(runId);
    expect(out?.step).toBe(2);
    expect(reads).toEqual([["value"]]);
    const [a] = await o<{ summary: { facts?: unknown; to_step?: number } }[]>`select summary
      from hub.audit_log where entity_id = ${runId} and action = 'branch'`;
    expect(a?.summary.facts).toEqual({ matched: true, reads: [{ key: "value", value: 150 }] });
  });

  it("trường trống ⇒ nhánh Sai, lịch sử ghi null", async () => {
    facts = {};
    const runId = await seedRun(1, ["done", "done", "pending", "pending"]);
    expect((await settle(runId))?.step).toBe(3);
    expect(await stagesOf(runId)).toEqual(["done", "done", "skipped", "queued"]);
  });

  it("Kết thúc ⇒ OutcomeHandler cùng tx, run done, nhánh sau skipped, gọi lại ⇒ already_applied, không đổi", async () => {
    facts = { value: 150 };
    const runId = await seedRun(1, ["done", "done", "pending", "pending"]);
    await settle(runId); // rẽ Đúng ⇒ bước 2
    await o`update hub.stage_runs set status = 'done' where process_run_id = ${runId} and stage_idx = 2`;
    expect((await settle(runId))?.kind).toBe("finish");
    expect((await runOf(runId))?.status).toBe("done");
    expect(await stagesOf(runId)).toEqual(["done", "done", "done", "skipped"]);
    expect(applied.filter((x) => x.runId === runId).map((x) => x.outcome)).toEqual(["approved"]);
    await settle(runId); // settle chạy lại (vd sau lỗi) ⇒ handler idempotent
    expect(applied.filter((x) => x.runId === runId).length).toBe(1);
    expect((await runOf(runId))?.status).toBe("done");
  });

  it("handler ném ⇒ rollback: run KHÔNG done (thử lại sau)", async () => {
    facts = { value: 150 };
    const runId = await seedRun(1, ["done", "done", "pending", "pending"]);
    await settle(runId);
    await o`update hub.stage_runs set status = 'done' where process_run_id = ${runId} and stage_idx = 2`;
    failNext = true;
    const err = await settle(runId).then(
      () => null,
      (e: Error) => e,
    );
    expect(err?.message).toBe("app lỗi");
    expect((await runOf(runId))?.status).not.toBe("done");
  });

  it("H2 · giá trị đổi sau khi rẽ (150 ⇒ 50) ⇒ Cần xử lý, không gọi handler", async () => {
    facts = { value: 150 };
    const runId = await seedRun(1, ["done", "done", "pending", "pending"]);
    await settle(runId);
    await o`update hub.stage_runs set status = 'done' where process_run_id = ${runId} and stage_idx = 2`;
    facts = { value: 50 };
    expect((await settle(runId))?.status).toBe("needs_decision");
    const r = await runOf(runId);
    expect({ status: r?.status, reason: r?.decision?.reason, ifx: r?.decision?.stage_idx }).toEqual(
      {
        status: "needs_decision",
        reason: "facts_changed",
        ifx: 1,
      },
    );
    expect((await stagesOf(runId))[2]).toBe("needs_decision");
    expect(applied.some((x) => x.runId === runId)).toBe(false);
  });
});
