// dify-workflows · int: lời gọi Dify (client thật + mock MK, không gọi Dify thật) → `recordDifyUsage` ghi cả `hub.usage_logs`
// lẫn `hub.dify_runs` với id phía Dify (workflow_run_id, conversation_id, task_id), trạng thái, trigger, token, lỗi đã che.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  HUB_API_URL,
  insertFixture,
  ownerSql,
  prepareDb,
  type Sql,
  T,
  USERS,
} from "../../../../../tests/acceptance/H1/_fixtures";
import { insertHubConfig } from "../../../../../tests/acceptance/H1/_hub";
import {
  type Dify,
  idGen2,
  insertCatalog,
  leakForms,
  setAppKey,
  startDify,
  WF,
} from "../../../../../tests/acceptance/H2a/_h2a";
import { connectDb, type Db } from "../../lib/db";
import { DifyClient, type DifyRunOutcome } from "./dify.client";
import { difyRunMeta, recordDifyUsage } from "./dify.usage";

let sql: Sql;
let db: Db;
let dify: Dify;
const id = idGen2(9700);

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  dify = startDify();
  await insertCatalog(sql, { baseUrl: dify.baseUrl });
  db = connectDb(HUB_API_URL, 2);
}, 60_000);
afterAll(async () => {
  await db?.close();
  await dify?.close();
  await sql?.end();
});

const run = (apiKey: string): Promise<DifyRunOutcome> =>
  new DifyClient().runStreaming(
    {
      appType: "workflow",
      baseUrl: dify.baseUrl,
      apiKey,
      inputs: { source_text: "xin", target_lang: "en" },
      query: null,
      user: `acme:${USERS.lan.id}`,
      conversationId: null,
      outputField: "text",
    },
    new AbortController().signal,
    () => {},
  );

async function record(out: DifyRunOutcome, trigger: "command" | "agent"): Promise<string> {
  const runId = id();
  await recordDifyUsage(db, {
    tenantId: T.acme,
    runId,
    stepId: id(),
    userId: USERS.lan.id,
    featureId: null,
    agentId: null,
    usage: out.usage,
    latencyMs: out.ms,
    run: difyRunMeta(out, WF.dich, trigger),
  });
  return runId;
}

describe("dify-workflows · ghi lịch sử chạy Dify cùng usage", () => {
  it("chạy thành công (fake Dify): dify_runs có workflow_run_id/conversation/task, status ok, trigger, token; usage_logs vẫn một dòng", async () => {
    await setAppKey(sql, "dich", "mk-ok");
    dify.mock.reset();
    const out = await run("mk-ok");
    expect(out.kind).toBe("finished");
    expect(out.workflowRunId).toBeTruthy();
    const runId = await record(out, "command");
    const rows = await sql`select * from hub.dify_runs where run_id = ${runId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_id: T.acme,
      user_id: USERS.lan.id,
      workflow_id: WF.dich,
      trigger: "command",
      status: "ok",
      input_tokens: 20,
      output_tokens: 0,
      error_message: null,
      dify_workflow_run_id: out.workflowRunId,
      dify_task_id: out.taskId,
      dify_conversation_id: out.conversationId,
    });
    expect(rows[0]?.duration_ms).toBe(out.ms);
    const usage =
      await sql`select 1 from hub.usage_logs where run_id = ${runId} and billing = 'dify'`;
    expect(usage).toHaveLength(1);
  });

  it("Dify lỗi HTTP: status failed + thông báo lỗi (không chứa app-key), trigger agent", async () => {
    await setAppKey(sql, "dich", "mk-401");
    const out = await run("mk-401");
    expect(out.kind).toBe("failed");
    const runId = await record(out, "agent");
    const [row] = await sql`select * from hub.dify_runs where run_id = ${runId}`;
    expect(row).toMatchObject({ status: "failed", trigger: "agent" });
    expect(String(row?.error_message)).toContain("401");
    for (const f of leakForms("mk-401")) expect(JSON.stringify(row)).not.toContain(f);
  });
});
