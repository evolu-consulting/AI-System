// CR-122 · E3 · node Ký số trong flow (gửi ký = tool gói; chờ = `wait_event` nhiều kết quả) — đường thật (role `hub_api`, scope
// system qua `createHubUow`): sự kiện từ chối ⇒ stage chờ xong với field `event`, rẽ tới nhánh Từ chối (nhánh Đã ký skipped);
// webhook trả về HAI lần ⇒ một kết quả (lần sau không thả gì, không thêm output).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Db } from "@ai/db";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { signalEvent } from "../../application/timers/signal-event.usecase";
import { createHubUow } from "../hub-uow";

let o: Sql;
let db: Db;
let close: () => Promise<void>;
let tid = "";
let uid = "";
let defId = "";

/** 0 gửi ký (tool, đã xong) · 1 Chờ ký (completed | declined | voided; rẽ declined→3, voided→3) · 2 Kết thúc Đã ký · 3 Kết thúc Từ chối. */
const SNAP = {
  key: "e3",
  name: "E3",
  trigger: { event: "contract.approved" },
  stages: [
    {
      key: "send",
      name: "Ký số",
      step: 0,
      executor: { kind: "tool", tool_key: "contracts-esign-send" },
    },
    {
      key: "wait",
      name: "Chờ ký",
      step: 1,
      executor: {
        kind: "wait_event",
        event: "esign.completed",
        timeout_h: 336,
        also_events: ["esign.declined", "esign.voided"],
        branches: [
          { on: "esign.declined", goto_step: 3 },
          { on: "esign.voided", goto_step: 3 },
          { on: "timeout", goto_step: 3 },
        ],
      },
    },
    { key: "ok", name: "Đã ký", step: 2, executor: { kind: "set" }, outcome: "signed" },
    { key: "no", name: "Từ chối", step: 3, executor: { kind: "set" }, outcome: "declined" },
  ],
};

async function seedRun(): Promise<string> {
  const [c] = await o<
    { id: string }[]
  >`insert into hub.conversations (tenant_id, user_id, title, title_norm)
    values (${tid}, ${uid}, 'c', 'c') returning id`;
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_runs (tenant_id, process_def_id, def_version,
      snapshot, started_by, origin_kind, input, conversation_id, flow_id, current_step, current_stage_idx, status)
    values (${tid}, ${defId}, 1, ${o.json(SNAP as never)}, ${uid}, 'admin', 'x', ${c?.id as string},
      gen_random_uuid(), 1, 1, 'waiting_timer') returning id`;
  const runId = r?.id as string;
  for (const [i, s] of ["done", "waiting_timer", "pending", "pending"].entries())
    await o`insert into hub.stage_runs (tenant_id, process_run_id, stage_idx, status)
      values (${tid}, ${runId}, ${i}, ${s})`;
  return runId;
}

const uow = () => createHubUow(db, { clock: { now: () => new Date() }, publish: async () => {} });
const signal = (runId: string, event: string) =>
  uow().system(tid, (repos) => signalEvent(repos, { runId, event, now: new Date() }));

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  const [t] = (await tenants(o, 1, 1223)) as [string];
  tid = t;
  uid = (await users(o, tid, 1, { from: 122_300 }))[0] as string;
  const [d] = await o<{ id: string }[]>`insert into hub.process_defs (tenant_id, key, name, stages)
    values (${tid}, 'e3', 'e3', ${o.json([{ key: "send" }])}) returning id`;
  defId = d?.id as string;
  const client = postgres(urls().hubApi, { max: 2, onnotice: () => {} });
  db = { db: drizzle(client), max: 2, close: () => client.end() } as unknown as Db;
  close = () => client.end({ timeout: 2 });
}, 300_000);
afterAll(async () => {
  await close?.();
  await o?.end({ timeout: 2 });
});

describe("CR-122 · E3 · chờ ký nhiều kết quả (đường thật)", () => {
  it("từ chối ký ⇒ stage chờ xong (event = esign.declined), rẽ tới Kết thúc · Từ chối, nhánh Đã ký skipped", async () => {
    const runId = await seedRun();
    expect(await signal(runId, "esign.declined")).toEqual({ kind: "ok", released: 1 });
    const st = await o<
      { status: string }[]
    >`select status from hub.stage_runs where process_run_id = ${runId}
      order by stage_idx`;
    expect(st.map((x) => x.status)).toEqual(["done", "done", "skipped", "queued"]);
    const [f] = await o<{ fields: { event?: string } }[]>`select o.fields from hub.stage_runs s
      join hub.process_outputs o on o.id = s.current_output_id where s.process_run_id = ${runId} and s.stage_idx = 1`;
    expect(f?.fields.event).toBe("esign.declined");
  });

  it("webhook trả về hai lần ⇒ một kết quả (lần 2 không thả, không thêm output)", async () => {
    const runId = await seedRun();
    expect(await signal(runId, "esign.completed")).toEqual({ kind: "ok", released: 1 });
    expect(await signal(runId, "esign.completed")).toEqual({ kind: "ok", released: 0 });
    const [n] = await o<{ n: number }[]>`select count(*)::int as n from hub.process_outputs
      where process_run_id = ${runId} and stage_idx = 1`;
    expect(n?.n).toBe(1);
    const [r] = await o<
      { current_step: number }[]
    >`select current_step from hub.process_runs where id = ${runId}`;
    expect(r?.current_step).toBe(2);
  });

  it("hai sự kiện cùng chờ (webhook + đồng bộ) ⇒ thắng cái nhận sớm, MỌI dòng cùng khoá đã dùng (không sót cho bước chờ sau)", async () => {
    const runId = await seedRun();
    await o`insert into hub.process_run_events (tenant_id, process_run_id, event, received_at)
      values (${tid}, ${runId}, 'esign.completed', now() - interval '1 minute')`;
    expect(await signal(runId, "esign.declined")).toEqual({ kind: "ok", released: 1 });
    const [f] = await o<{ fields: { event?: string } }[]>`select o.fields from hub.stage_runs s
      join hub.process_outputs o on o.id = s.current_output_id where s.process_run_id = ${runId} and s.stage_idx = 1`;
    expect(f?.fields.event).toBe("esign.completed");
    const [left] = await o<{ n: number }[]>`select count(*)::int as n from hub.process_run_events
      where process_run_id = ${runId} and consumed_by is null`;
    expect(left?.n).toBe(0);
  });

  it("sự kiện lạ (không thuộc khoá chờ) ⇒ không thả", async () => {
    const runId = await seedRun();
    expect(await signal(runId, "esign.other")).toEqual({ kind: "ok", released: 0 });
  });
});
