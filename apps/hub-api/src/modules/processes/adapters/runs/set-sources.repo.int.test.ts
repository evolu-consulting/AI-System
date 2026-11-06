// CR-122 · E4 · đường thật (role `hub_api`, scope system): nguồn node Ghi giá trị — field output hiện hành theo BƯỚC trước (1 câu) +
// dữ kiện qua `FactsReader`; giá trị sai dạng ⇒ MỘT dòng audit, không ném; chỉ input/hằng ⇒ 0 câu.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Db, Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { type SetExec, setFieldsOf } from "../../domain/set/set.rules";
import { registerFactsReader, unregisterFlowPorts } from "./flow-ports";
import { auditSetBad, setSourcesOf } from "./set-sources.repo";

const PACK = "e4test";
const EVENT = "e4test.submitted";
let o: Sql;
let db: Db;
let close: () => Promise<void>;
let tid = "";
let uid = "";
let runId = "";
const queries: string[] = [];

const SNAP = {
  key: "e4",
  name: "E4",
  trigger: { event: EVENT },
  stages: [
    { key: "a", step: 0, executor: { kind: "agent" } },
    { key: "bridge", step: 1, executor: { kind: "set" } },
  ],
};
const EXEC: SetExec = {
  kind: "set",
  values: [
    { key: "amount", from: { kind: "field", step: 0, key: "value" }, as: "number" },
    { key: "kind", from: { kind: "fact", key: "contract_kind" } },
    { key: "bad", from: { kind: "fact", key: "signed_at" }, as: "date" },
  ],
};

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  const [t] = (await tenants(o, 1, 1224)) as [string];
  tid = t;
  uid = (await users(o, tid, 1, { from: 122_400 }))[0] as string;
  const [d] = await o<{ id: string }[]>`insert into hub.process_defs (tenant_id, key, name, stages)
    values (${tid}, 'e4', 'e4', ${o.json([{ key: "a" }])}) returning id`;
  const [c] = await o<
    { id: string }[]
  >`insert into hub.conversations (tenant_id, user_id, title, title_norm)
    values (${tid}, ${uid}, 'c', 'c') returning id`;
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_runs (tenant_id, process_def_id, def_version,
      snapshot, started_by, origin_kind, input, conversation_id, flow_id, current_step, current_stage_idx,
      pack_key, pack_record_id)
    values (${tid}, ${d?.id as string}, 1, ${o.json(SNAP as never)}, ${uid}, 'admin', 'x', ${c?.id as string},
      gen_random_uuid(), 1, 1, ${PACK}, gen_random_uuid()) returning id`;
  runId = r?.id as string;
  const [s0] = await o<
    { id: string }[]
  >`insert into hub.stage_runs (tenant_id, process_run_id, stage_idx, status)
    values (${tid}, ${runId}, 0, 'done') returning id`;
  await o`insert into hub.stage_runs (tenant_id, process_run_id, stage_idx, status) values (${tid}, ${runId}, 1, 'running')`;
  const [out] = await o<
    { id: string }[]
  >`insert into hub.process_outputs (tenant_id, process_run_id, stage_run_id,
      stage_idx, version, attempt, content, template_ok, fields)
    values (${tid}, ${runId}, ${s0?.id as string}, 0, 1, 1, '# a', true, ${o.json({ value: "150000000" } as never)})
    returning id`;
  await o`update hub.stage_runs set current_output_id = ${out?.id as string} where id = ${s0?.id as string}`;
  const client = postgres(urls().hubApi, {
    max: 2,
    onnotice: () => {},
    debug: (_c, q) => void queries.push(q),
  });
  db = { db: drizzle(client), max: 2, close: () => client.end() } as unknown as Db;
  close = () => client.end({ timeout: 2 });
  registerFactsReader({
    packKey: PACK,
    events: [EVENT],
    read: async () => ({ contract_kind: "mua_hang", signed_at: "hôm qua" }),
  });
}, 300_000);
afterAll(async () => {
  unregisterFlowPorts(PACK);
  await close?.();
  await o?.end({ timeout: 2 });
});

const sys = <T>(fn: (tx: Tx) => Promise<T>) => withHubScope(db, { kind: "system" }, fn);

describe("CR-122 · E4 · nguồn node Ghi giá trị (đường thật)", () => {
  it("field bước trước + dữ kiện ⇒ amount = 150000000, kind, sai dạng ⇒ null + 1 dòng audit", async () => {
    const r = await sys(async (tx) => {
      const src = await setSourcesOf(tx, { tenantId: tid, runId, exec: EXEC, inputs: {} });
      const f = setFieldsOf(EXEC, src);
      await auditSetBad(tx, { tenantId: tid, runId, stageIdx: 1, keys: f.bad });
      return f;
    });
    expect(r.fields).toEqual({ amount: 150_000_000, kind: "mua_hang", bad: null });
    const rows = await o<{ summary: { keys?: string[] } }[]>`select summary from hub.audit_log
      where entity_id = ${runId} and action = 'update' and summary->>'kind' = 'set_value_invalid'`;
    expect(rows.map((x) => x.summary.keys)).toEqual([["bad"]]);
  });

  it("chỉ input/hằng ⇒ 0 câu SQL thêm", async () => {
    const exec: SetExec = { kind: "set", values: [{ key: "u", from: { const: "VND" } }] };
    const n = await sys(async (tx) => {
      queries.length = 0;
      await setSourcesOf(tx, { tenantId: tid, runId, exec, inputs: {} });
      return queries.length;
    });
    expect(n).toBe(0);
  });
});
