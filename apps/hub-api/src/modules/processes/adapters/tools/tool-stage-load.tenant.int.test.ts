// CR-123 · u6c · RANH GIỚI TENANT của `loadCallRow` (stage tool): run của công ty A đọc def qua `d.id` + (`d.tenant_id = r.tenant_id` hoặc
// def Thư viện `tenant_id IS NULL`). (1) def Thư viện ⇒ can_run = true; (2) def RIÊNG của công ty B không nạp được cho run của A (can_run = false);
// (3) def riêng của A vẫn chạy. Đường thật, scope system.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eventOf, recordInputsOf } from "@ai/contracts/app-manifest";
import type { Db, Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { loadCallRow, toLoad } from "./tool-stage-load.repo";

let o: Sql;
let db: Db;
let close: () => Promise<void>;
let tid = "";
let uid = "";
let libDef = "";
let ownDef = "";
let otherDef = "";
const CONTRACT = "0f3c2a10-8b1e-4c55-9d7a-1a2b3c4d5e6f";
async function seed(
  defId: string,
  args: object = {},
): Promise<{ runId: string; stageRunId: string; hubRunId: string }> {
  const snap = {
    key: "g1",
    name: "Duyệt HĐ",
    trigger: { event: "contract.submitted" },
    stages: [
      {
        key: "gui-ky",
        name: "Gửi ký số",
        step: 0,
        node: "contracts.esign",
        executor: { kind: "tool", tool_key: "contracts-esign-send", args },
        output: { fields: [] },
      },
    ],
  };
  const inputs = recordInputsOf(eventOf("contracts", "contract.submitted"), CONTRACT, {});
  const [c] = await o<
    { id: string }[]
  >`insert into hub.conversations (tenant_id, user_id, title, title_norm)
    values (${tid}, ${uid}, 'c', 'c') returning id`;
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_runs (tenant_id, process_def_id, def_version,
      snapshot, started_by, origin_kind, input, conversation_id, flow_id, inputs, pack_key, pack_record_id)
    values (${tid}, ${defId}, 1, ${o.json(snap as never)}, ${uid}, 'admin', 'x', ${c?.id as string},
      gen_random_uuid(), ${o.json(inputs as never)}, 'contracts', ${CONTRACT}) returning id`;
  const hubRunId = crypto.randomUUID();
  const [s] = await o<
    { id: string }[]
  >`insert into hub.stage_runs (tenant_id, process_run_id, stage_idx, status)
    values (${tid}, ${r?.id as string}, 0, 'running') returning id`;
  // `current_run_id` có FK tới `hub.runs` (→ `hub.flows`) ⇒ dựng flow + lần chạy hub của stage trước khi gắn.
  await o`insert into hub.flows (id, tenant_id, user_id, conversation_id, title)
    select r.flow_id, r.tenant_id, r.started_by, r.conversation_id, 'g1'
    from hub.process_runs r where r.id = ${r?.id as string}`;
  await o`insert into hub.runs (id, tenant_id, user_id, conversation_id, flow_id, status, config_version,
      user_message_id, answer_message_id, process_run_id, stage_run_id)
    select ${hubRunId}, r.tenant_id, r.started_by, r.conversation_id, r.flow_id, 'running', 1,
      gen_random_uuid(), gen_random_uuid(), r.id, ${s?.id as string}
    from hub.process_runs r where r.id = ${r?.id as string}`;
  await o`update hub.stage_runs set current_run_id = ${hubRunId} where id = ${s?.id as string}`;
  return { runId: r?.id as string, stageRunId: s?.id as string, hubRunId };
}

const mkDef = async (tenant: string | null, key: string): Promise<string> => {
  const [d] = await o<{ id: string }[]>`insert into hub.process_defs (tenant_id, key, name, stages)
    values (${tenant}, ${key}, ${key}, ${o.json([{ key: "gui-ky" }])}) returning id`;
  return d?.id as string;
};

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  const [a, b] = (await tenants(o, 2, 1238)) as [string, string];
  tid = a;
  uid = (await users(o, a, 1, { from: 123_800 }))[0] as string;
  libDef = await mkDef(null, "u6c-lib");
  ownDef = await mkDef(a, "u6c-own");
  otherDef = await mkDef(b, "u6c-other");
  const client = postgres(urls().hubApi, { max: 2, onnotice: () => {} });
  db = { db: drizzle(client), max: 2, close: () => client.end() } as unknown as Db;
  close = () => client.end({ timeout: 2 });
}, 300_000);
afterAll(async () => {
  await close?.();
  await o?.end({ timeout: 2 });
});

const load = (k: Awaited<ReturnType<typeof seed>>) =>
  withHubScope(db, { kind: "system" }, async (tx: Tx) => {
    const row = await loadCallRow(tx, { tenantId: tid, ...k });
    return row ? toLoad(row) : null;
  });

describe("CR-123 · u6c · loadCall nối def theo tenant", () => {
  it("def Thư viện (tenant_id NULL) của run công ty A ⇒ can_run = true", async () => {
    expect((await load(await seed(libDef)))?.canRun).toBe(true);
  });
  it("def RIÊNG của công ty B không nạp được cho run của A ⇒ can_run = false", async () => {
    expect((await load(await seed(otherDef)))?.canRun).toBe(false);
  });
  it("def riêng của A vẫn chạy ⇒ can_run = true", async () => {
    expect((await load(await seed(ownDef)))?.canRun).toBe(true);
  });
});
