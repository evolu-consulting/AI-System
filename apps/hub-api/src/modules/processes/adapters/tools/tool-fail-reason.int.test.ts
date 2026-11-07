// CR-122 · p19-tool-reason · stage `tool` lỗi ⇒ `last_error_code` có MÃ MÁY và thẻ HĐ (attention) mang mã đó — thứ người dùng thấy.
// Đường thật: loadCall → runToolStage → toolStageRepo.decide (DB) → stepsView → attentionOf. Cổng gói giả: Ký số bật cho tenant.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eventOf, recordInputsOf } from "@ai/contracts/app-manifest";
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { attentionOf } from "../../../packs/contracts/public";
import type { PackToolCatalog } from "../../../packs/kit/public";
import type { TxRepos } from "../../application/ports";
import { runToolStage } from "../../application/tools/run-tool-stage.usecase";
import type { ToolCallResult } from "../../application/tools/tool.ports";
import type { ProcessDeps } from "../../core/ports";
import { stepsView } from "../../runs/pack-runs-view";
import { toolStageRepo } from "./tool-stage.repo";

let o: Sql;
let db: Db;
let close: () => Promise<void>;
let tid = "";
let uid = "";
let defId = "";
const CONTRACT = "0f3c2a10-8b1e-4c55-9d7a-1a2b3c4d5e70";
const KEY = "contracts-esign-send";

const catalog = {
  info: () => ({ key: KEY, sideEffect: true }),
  enabled: async () => true,
  canUse: async () => true,
} as unknown as PackToolCatalog;
const deps = {
  db: null as unknown as Db,
  now: () => new Date(),
  packTools: catalog,
  notifier: { taskOpened: async () => [] },
  config: { user: async () => ({ groupIds: new Set<string>() }) },
} as unknown as ProcessDeps;

async function seed(args: object) {
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
        real_action: true,
        executor: { kind: "tool", tool_key: KEY, args },
        output: { fields: [] },
        after: { kind: "auto" },
      },
    ],
  };
  const inputs = recordInputsOf(eventOf("contracts", "contract.submitted"), CONTRACT, { value: 1 });
  const [c] = await o<
    { id: string }[]
  >`insert into hub.conversations (tenant_id, user_id, title, title_norm) values (${tid}, ${uid}, 'c', 'c') returning id`;
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_runs (tenant_id, process_def_id, def_version, snapshot, started_by, origin_kind, input,
      conversation_id, flow_id, inputs, pack_key, pack_record_id)
    values (${tid}, ${defId}, 1, ${o.json(snap as never)}, ${uid}, 'admin', 'x', ${c?.id as string},
      gen_random_uuid(), ${o.json(inputs as never)}, 'contracts', ${CONTRACT}) returning id`;
  const hubRunId = crypto.randomUUID();
  const [s] = await o<
    { id: string }[]
  >`insert into hub.stage_runs (tenant_id, process_run_id, stage_idx, status) values (${tid}, ${r?.id as string}, 0, 'running') returning id`;
  await o`insert into hub.flows (id, tenant_id, user_id, conversation_id, title)
    select r.flow_id, r.tenant_id, r.started_by, r.conversation_id, 'g1' from hub.process_runs r where r.id = ${r?.id as string}`;
  await o`insert into hub.runs (id, tenant_id, user_id, conversation_id, flow_id, status, config_version,
      user_message_id, answer_message_id, process_run_id, stage_run_id)
    select ${hubRunId}, r.tenant_id, r.started_by, r.conversation_id, r.flow_id, 'running', 1,
      gen_random_uuid(), gen_random_uuid(), r.id, ${s?.id as string} from hub.process_runs r where r.id = ${r?.id as string}`;
  await o`update hub.stage_runs set current_run_id = ${hubRunId} where id = ${s?.id as string}`;
  return { runId: r?.id as string, stageRunId: s?.id as string, hubRunId, tenantId: tid };
}

const run = (link: Awaited<ReturnType<typeof seed>>, res: ToolCallResult) =>
  runToolStage(
    {
      invoker: { call: async () => res },
      clock: { now: () => new Date() },
      log: { warn: () => {}, info: () => {}, error: () => {} } as never,
      uow: {
        system: (t, fn) =>
          withHubScope(db, { kind: "system" }, (tx) =>
            fn({
              runs: { lock: async () => true },
              tools: toolStageRepo(tx, t, { emit: () => {} } as never, { ...deps, db }),
            } as unknown as TxRepos),
          ),
      },
    },
    link,
  );

const stageCode = async (id: string) =>
  (
    await o<
      { c: string | null }[]
    >`select last_error_code as c from hub.stage_runs where id = ${id}`
  )[0]?.c;

async function card(runId: string) {
  const sv = await stepsView(
    { ...deps, db },
    { userId: uid, tenantId: tid, role: "member" } as never,
    runId,
  );
  return attentionOf({
    approval: { id: "a", status: "level1", startedBy: uid, feedback: null },
    flow: [],
    facts: {} as never,
    sv: sv as never,
    viewerId: uid,
  });
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  const [t] = (await tenants(o, 1, 1226)) as [string];
  tid = t;
  uid = (await users(o, tid, 1, { from: 122_600 }))[0] as string;
  const [d] = await o<{ id: string }[]>`insert into hub.process_defs (tenant_id, key, name, stages)
    values (${tid}, 'g1', 'g1', ${o.json([{ key: "gui-ky" }])}) returning id`;
  defId = d?.id as string;
  const client = postgres(urls().hubApi, { max: 2, onnotice: () => {} });
  db = { db: drizzle(client), max: 2, close: () => client.end() } as unknown as Db;
  close = () => client.end({ timeout: 2 });
}, 300_000);
afterAll(async () => {
  await close?.();
  await o?.end({ timeout: 2 });
});

describe("CR-122 · p19 · tool lỗi ⇒ mã máy trên stage + thẻ HĐ", () => {
  it("tool trả ESIGN_DISABLED ⇒ stage needs_decision, last_error_code, thẻ có code", async () => {
    const link = await seed({});
    const out = await run(link, {
      kind: "failed",
      code: "ESIGN_DISABLED",
      httpStatus: null,
      sent: true,
      reason: null,
    });
    expect(out).toEqual({ kind: "decide", reason: "tool_failed" });
    expect(await stageCode(link.stageRunId)).toBe("ESIGN_DISABLED");
    expect(await card(link.runId)).toMatchObject({
      kind: "needs_decision",
      reason: "tool_failed",
      code: "ESIGN_DISABLED",
    });
  });

  it("thiếu đầu vào ⇒ MISSING_ARG:<tên>", async () => {
    const link = await seed({ x: { from: "input", key: "khong_co" } });
    await run(link, { kind: "ok", text: "{}" });
    expect(await stageCode(link.stageRunId)).toBe("MISSING_ARG:x");
    expect((await card(link.runId))?.code).toBe("MISSING_ARG:x");
  });
});
