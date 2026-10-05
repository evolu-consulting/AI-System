// HUB-FR-23 · H2a-R14 · REVIEW 1 Hub #5: phiên `dify-agent` có `conversation_id` mà Dify trả 404 → Hub xoá dòng
// `cli_sessions(provider_key='dify')` rồi thử lại đúng một lần không kèm `conversation_id`. Mock MK khoá (`tools/hub-dev`)
// không có kịch bản "conversation lạ → 404" nên dùng client Dify giả cạnh code; DB test + role `hub_api` thật.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { RunEvent } from "@ai/contracts/hub";
import {
  HUB_API_URL,
  insertFixture,
  ownerSql,
  prepareDb,
  type Sql,
  USERS,
} from "../../../../../tests/acceptance/H1/_fixtures";
import { insertHubConfig } from "../../../../../tests/acceptance/H1/_hub";
import {
  AG2,
  idGen2,
  insertCatalog,
  insertH2aAgents,
} from "../../../../../tests/acceptance/H2a/_h2a";
import { connectDb, type Db } from "../../lib/db";
import { logger } from "../../lib/logger";
import { type ConfigCache, startConfigCache } from "../config/config.service";
import type { AgentTask } from "../runner/job-agent-runner";
import type { DifyClient, DifyRunOutcome, DifyRunRequest } from "./dify.client";
import { DifyAgentRunner } from "./dify-agent-runner";

const OWNER = "rv1-dify-agent";
const STALE = "conv-stale";
let sql: Sql;
let db: Db;
let config: ConfigCache;
const ac = new AbortController();
const id = idGen2(9700);
const L = USERS.lan;

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  await insertCatalog(sql, { baseUrl: "http://dify.invalid/v1" });
  await insertH2aAgents(sql);
  db = connectDb(HUB_API_URL, 2);
  config = startConfigCache(db, { pollS: 60, log: logger, signal: ac.signal });
}, 60_000);
afterAll(async () => {
  ac.abort();
  await db?.close();
  await sql?.end();
});

const META = { taskId: null, usage: { input_tokens: 0, output_tokens: 0, cost_usd: 0 }, ms: 5 };
const notFound: DifyRunOutcome = {
  kind: "failed",
  code: "NOT_CONFIGURED",
  reason: "upstream",
  detail: '{"code":"not_found","message":"Conversation Not Exists."}',
  httpStatus: 404,
  conversationId: null,
  ...META,
};
const done = (conv: string): DifyRunOutcome => ({
  kind: "finished",
  text: "trả lời mới",
  conversationId: conv,
  ...META,
  taskId: "task-1",
});

/** Client Dify giả: trả lần lượt `outs`, ghi `conversationId` của từng lời gọi. */
function fakeDify(outs: DifyRunOutcome[]) {
  const calls: (string | null)[] = [];
  const dify: Pick<DifyClient, "runStreaming"> = {
    runStreaming: async (req: DifyRunRequest) => {
      calls.push(req.conversationId);
      const out = outs[calls.length - 1];
      if (!out) throw new Error("gọi Dify quá số lần dự kiến");
      return out;
    },
  };
  return { dify, calls };
}

/** Hội thoại + run `running` của `OWNER`; tuỳ chọn phiên Dify sẵn có. */
async function liveRun(session: string | null): Promise<AgentTask["run"]> {
  const [conv, flow, mu, ma, run] = [id(), id(), id(), id(), id()] as const;
  await sql`insert into hub.conversations (id, tenant_id, user_id, title, title_norm)
    values (${conv}, ${L.tid}, ${L.id}, 'rv1', 'rv1')`;
  await sql`insert into hub.flows (id, tenant_id, user_id, conversation_id, title, message_count)
    values (${flow}, ${L.tid}, ${L.id}, ${conv}, 'rv1', 2)`;
  await sql`insert into hub.messages (id, tenant_id, user_id, conversation_id, flow_id, role, content, run_id) values
    (${mu}, ${L.tid}, ${L.id}, ${conv}, ${flow}, 'user', 'hỏi', null),
    (${ma}, ${L.tid}, ${L.id}, ${conv}, ${flow}, 'assistant', '', ${run})`;
  await sql`insert into hub.runs (id, tenant_id, user_id, conversation_id, flow_id, status, config_version,
      user_message_id, answer_message_id, owner, lease_until)
    values (${run}, ${L.tid}, ${L.id}, ${conv}, ${flow}, 'running', 1, ${mu}, ${ma}, ${OWNER},
      now() + interval '1 hour')`;
  if (session)
    await sql`insert into hub.cli_sessions (conversation_id, agent_id, provider_key, tenant_id, session_id)
      values (${conv}, ${AG2.difyTroLy}, 'dify', ${L.tid}, ${session})`;
  return {
    id: run,
    tenantId: L.tid,
    userId: L.id,
    conversationId: conv,
    flowId: flow,
    locale: "vi",
  };
}

async function runAgent(run: AgentTask["run"], dify: Pick<DifyClient, "runStreaming">) {
  const snapshot = await config.snapshot();
  const agent = snapshot.agents.find((a) => a.id === AG2.difyTroLy);
  if (!agent) throw new Error("thiếu agent dify-tro-ly");
  const runner = new DifyAgentRunner({
    db,
    owner: OWNER,
    catalog: () => config.catalog(),
    credentials: { apiKey: async () => "k-rv1" },
    dify,
    log: logger,
  });
  const task: AgentTask = { run, snapshot, agent, role: "agent", prompt: "hỏi tiếp", history: [] };
  const events: RunEvent[] = [];
  for await (const ev of runner.run(task, new AbortController().signal)) events.push(ev);
  return events;
}

const sessionOf = async (run: AgentTask["run"]) =>
  (
    await sql<{ session_id: string }[]>`select session_id from hub.cli_sessions
      where conversation_id = ${run.conversationId} and agent_id = ${AG2.difyTroLy} and provider_key = 'dify'`
  ).map((r) => r.session_id);

describe("HUB-FR-23 · phiên dify-agent hết hạn phía Dify (404) [H2a-R14 · REVIEW 1 Hub #5]", () => {
  it("404 với conversation_id → xoá phiên, thử lại một lần không conversation_id → xong, lưu phiên mới", async () => {
    const run = await liveRun(STALE);
    const f = fakeDify([notFound, done("conv-moi")]);
    const events = await runAgent(run, f.dify);
    expect(f.calls).toEqual([STALE, null]);
    const last = events.at(-1);
    expect(last?.type).toBe("job.result");
    expect(last).toMatchObject({ session_resumed: false });
    expect(await sessionOf(run)).toEqual(["conv-moi"]);
  });

  it("404 lần thử lại → không thử lần ba; run lỗi NOT_CONFIGURED, phiên cũ đã xoá", async () => {
    const run = await liveRun(STALE);
    const f = fakeDify([notFound, notFound]);
    const events = await runAgent(run, f.dify);
    expect(f.calls).toEqual([STALE, null]);
    expect(events.at(-1)).toMatchObject({ type: "job.failed", code: "NOT_CONFIGURED" });
    expect(await sessionOf(run)).toEqual([]);
  });

  it("404 khi không có phiên → không thử lại (một lời gọi)", async () => {
    const run = await liveRun(null);
    const f = fakeDify([notFound]);
    const events = await runAgent(run, f.dify);
    expect(f.calls).toEqual([null]);
    expect(events.at(-1)).toMatchObject({ type: "job.failed", code: "NOT_CONFIGURED" });
  });
});
