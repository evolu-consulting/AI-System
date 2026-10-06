// HUB-FR-52 · HUB-FR-87 · dữ liệu trace H3b (test-plan-cases H3b §2.7): run + step (orchestrator, delegate, workflow, tool,
// step lỗi) + job + usage + tin nhắn bằng SQL owner; chuỗi bí mật mẫu `PLANTED` cài vào `run_steps.detail` và
// `jobs.payload/result/token_hash/error_message` để quét lộ. Không chứa `it(...)`.
import { createHash } from "node:crypto";
import type { Sql } from "../H1/_fixtures";
import { AGT, idGen3, userOf, type Who } from "./_h3b";

export const MSG_MARK = "QC_MSG_MARK_H3B_51c2";
export const PLANTED = {
  appKey: "app-QcPlantedKey0123456789AB",
  bearer: "Bearer qcPlantedBearer.tok123",
  sk: "sk-qcPlantedSecret_0123456789",
  jobSecret: "QC_JOB_SECRET_7f3a9c2e",
} as const;
export const PLANTED_ALL = Object.values(PLANTED);
/** `detail` lỗi kiểu H1-R26 (N1/PL15). */
export const ERR_DETAIL = {
  message: "MSG_ERR",
  upstream: "UP_ERR",
  usage: { input_tokens: 5, output_tokens: 7 },
};
export const WORKFLOW_ID = "a3b00000-0000-4000-8000-000000000901";
const T0 = new Date("2026-10-06T08:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
/** ms của mỗi step đã xong. */
export const STEP_MS = 1234;

export type TraceRun = {
  id: string;
  tenant: string;
  steps: string[];
  jobs: string[];
  userMsg: string;
  answerMsg: string;
};

async function insertConvRun(sql: Sql, w: Who, runId: string, next: () => string) {
  const u = userOf(w);
  const [conv, flow, um, am] = [next(), next(), next(), next()];
  await sql`insert into hub.conversations (id, tenant_id, user_id, title, title_norm)
    values (${conv}, ${u.tid}, ${u.id}, 'Trace', 'trace')`;
  await sql`insert into hub.flows (id, tenant_id, user_id, conversation_id, title, message_count)
    values (${flow}, ${u.tid}, ${u.id}, ${conv}, 'Trace', 2)`;
  await sql`insert into hub.messages (id, tenant_id, user_id, conversation_id, flow_id, role, content, run_id) values
    (${um}, ${u.tid}, ${u.id}, ${conv}, ${flow}, 'user', ${`${MSG_MARK} câu hỏi`}, null),
    (${am}, ${u.tid}, ${u.id}, ${conv}, ${flow}, 'assistant', ${`${MSG_MARK} trả lời`}, ${runId})`;
  await sql`insert into hub.runs (id, tenant_id, user_id, conversation_id, flow_id, status, config_version,
      user_message_id, answer_message_id, last_seq, tokens_used, started_at, finished_at)
    values (${runId}, ${u.tid}, ${u.id}, ${conv}, ${flow}, 'finished', 1, ${um}, ${am}, 5, 120, ${at(0)}, ${at(9000)})`;
  return { u, um, am, conv };
}

type StepSpec = {
  type: string;
  agent: string | null;
  wf: string | null;
  status: string;
  detail: unknown;
};
const BASE_STEPS: StepSpec[] = [
  {
    type: "orchestrator",
    agent: AGT.orch,
    wf: null,
    status: "ok",
    detail: {
      api_key: PLANTED.appKey,
      headers: { Authorization: PLANTED.bearer },
      note: PLANTED.sk,
    },
  },
  {
    type: "delegate",
    agent: AGT.hoadon,
    wf: null,
    status: "ok",
    detail: { tokenBudget: PLANTED.jobSecret },
  },
  {
    type: "workflow",
    agent: null,
    wf: WORKFLOW_ID,
    status: "ok",
    detail: { inputs: { lang: "en" } },
  },
  { type: "tool", agent: null, wf: WORKFLOW_ID, status: "ok", detail: null },
  { type: "delegate", agent: AGT.hoadon, wf: null, status: "failed", detail: ERR_DETAIL },
];

/**
 * Run `finished` của `w` (owner). Mặc định 5 step (orchestrator, delegate, workflow, tool, delegate lỗi `ERR_DETAIL`),
 * 2 job (step 1, 2; cài `PLANTED`), usage: step 1 (100/20, 0.001), step 2 hai dòng (50/10, 0.0005 + 5/1, NULL),
 * dòng `step_id` NULL (7/3, 0.0001). `steps`/`jobs` > 5/2 ⇒ thêm step `delegate` ok / job (A99).
 */
export async function insertTraceRun(
  sql: Sql,
  w: Who,
  runId: string,
  o: { steps?: number; jobs?: number; base: number },
): Promise<TraceRun> {
  const next = idGen3(o.base);
  const { u, um, am, conv } = await insertConvRun(sql, w, runId, next);
  const specs = [...BASE_STEPS];
  while (specs.length < (o.steps ?? 5))
    specs.push({
      type: "delegate",
      agent: AGT.hoadon,
      wf: null,
      status: "ok",
      detail: { i: specs.length },
    });
  const steps = specs.map((s, i) => ({
    id: next(),
    tenant_id: u.tid,
    user_id: u.id,
    run_id: runId,
    seq: i + 1,
    type: s.type,
    agent_id: s.agent,
    workflow_id: s.wf,
    provider_key: s.agent ? "fake-cli" : null,
    label_key: `step.${s.type}`,
    status: s.status,
    detail: s.detail === null ? null : sql.json(s.detail as never),
    started_at: at(i * 2000),
    finished_at: at(i * 2000 + STEP_MS),
  }));
  for (let i = 0; i < steps.length; i += 100)
    await sql`insert into hub.run_steps ${sql(steps.slice(i, i + 100))}`;
  const jobs = Array.from({ length: o.jobs ?? 2 }, () => next()).map((jobId, i) => ({
    id: jobId,
    tenant_id: u.tid,
    user_id: u.id,
    run_id: runId,
    step_id: steps[Math.min(i, 1)]?.id ?? "",
    conversation_id: conv,
    agent_id: AGT.hoadon,
    type: "agent.cli",
    provider_key: "fake-cli",
    payload: sql.json({ prompt: `${PLANTED.jobSecret} ${MSG_MARK}`, api_key: PLANTED.appKey }),
    status: "succeeded",
    attempts: 1,
    result: sql.json({ text: `${PLANTED.sk} ${MSG_MARK}` }),
    token_hash: createHash("sha256").update(jobId).digest(),
    error_message: PLANTED.bearer,
    started_at: at(i * 10),
    finished_at: at(i * 10 + 500),
    created_at: at(i * 10),
  }));
  for (let i = 0; i < jobs.length; i += 100)
    await sql`insert into hub.jobs ${sql(jobs.slice(i, i + 100))}`;
  const usage = (stepId: string | null, input: number, output: number, cost: string | null) => ({
    tenant_id: u.tid,
    run_id: runId,
    step_id: stepId,
    user_id: u.id,
    agent_id: AGT.hoadon,
    provider_key: "fake-cli",
    model: "haiku",
    billing: "subscription",
    input_tokens: input,
    output_tokens: output,
    cost_usd: cost,
    billable_usd: cost,
  });
  const s1 = steps[0]?.id ?? null;
  const s2 = steps[1]?.id ?? null;
  await sql`insert into hub.usage_logs ${sql([
    usage(s1, 100, 20, "0.001000"),
    usage(s2, 50, 10, "0.000500"),
    usage(s2, 5, 1, null),
    usage(null, 7, 3, "0.000100"),
  ])}`;
  return {
    id: runId,
    tenant: u.tid,
    steps: steps.map((s) => s.id),
    jobs: jobs.map((j) => j.id),
    userMsg: um,
    answerMsg: am,
  };
}
/** Tổng usage mặc định của `insertTraceRun` (gồm dòng step NULL). */
export const USAGE_TOTAL = { input_tokens: 162, output_tokens: 34 };
