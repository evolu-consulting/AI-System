// HUB-FR-13, HUB-FR-50, WRK-FR-07, WRK-FR-13 · Runtime kịch bản H2a (test-plan H2a §2): bọc `ScriptRuntime` H1 (không sửa
// file khoá). Claim job `workflow.async` như Runtime (RT1): `queued → running` + `token_hash = sha256(token)` trong cùng
// câu UPDATE, token 43 ký tự base64url chỉ giữ trong bộ nhớ test; job `agent.cli` có MCP dựng bằng SQL owner (Q-T8);
// gọi `/mcp` và `/internal/jobs/:id/dify-credential` bằng token đó. Không chứa `it(...)`.

import { expect } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { type AgentCliJob, JobPayloadSchema, type WorkflowAsyncJob } from "@ai/contracts/hub";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import { call, type Hub, type Res, type Sql, USERS, type UserKey } from "../H1/_fixtures";
import { type Job, ScriptRuntime } from "../H1/_runtime";

/** Token job như Runtime (`secrets.token_urlsafe(32)`): 43 ký tự base64url không padding. */
export const newJobToken = (): string => randomBytes(32).toString("base64url");
export const tokenHash = (t: string): Buffer => createHash("sha256").update(t, "ascii").digest();

export type AsyncJob = { job: Job; token: string; payload: WorkflowAsyncJob };

export class ScriptRuntime2 {
  readonly rt: ScriptRuntime;
  constructor(
    private readonly sql: Sql,
    redis: Redis,
    readonly workerId = "qc-rt-h2a",
  ) {
    this.rt = new ScriptRuntime(sql, redis, workerId);
  }

  /** Job `workflow.async` `queued` của run (không claim); hết `ms` → undefined. */
  async peekAsync(
    runId: string,
    ms = 5_000,
  ): Promise<{ id: string; payload: unknown } | undefined> {
    const end = Date.now() + ms;
    for (;;) {
      const [row] = await this.sql<
        { id: string; payload: unknown }[]
      >`select id, payload from hub.jobs
        where run_id = ${runId} and type = 'workflow.async' and status = 'queued'
        order by created_at, id limit 1`;
      if (row || Date.now() > end) return row;
      await Bun.sleep(50);
    }
  }

  /** Claim kèm token (RT1) + XADD `job.started`. Hub chưa tạo job → đỏ ở `expect`. */
  async claimAsync(runId: string, ms = 5_000): Promise<AsyncJob> {
    const row = await this.peekAsync(runId, ms);
    expect(row).toBeDefined();
    const parsed = JobPayloadSchema.safeParse(row?.payload);
    expect(parsed.success).toBe(true);
    const token = newJobToken();
    const claimed = await this
      .sql`update hub.jobs set status = 'running', worker_id = ${this.workerId},
        started_at = now(), heartbeat_at = now(), attempts = attempts + 1, token_hash = ${tokenHash(token)}
      where id = ${row?.id ?? null} and status = 'queued' returning id`;
    expect(claimed.length).toBe(1);
    const payload = parsed.data as WorkflowAsyncJob;
    const job: Job = { id: row?.id ?? "", runId, payload: payload as unknown as AgentCliJob };
    await this.rt.emit(job, {
      type: "job.started",
      worker_id: this.workerId,
      provider_key: "dify",
    });
    return { job, token, payload };
  }
}

// ---------- job dựng bằng SQL (credential A81–A83, A86; MCP A80, A92) ----------
const AGENT_MCP_FIXTURE = JSON.parse(
  readFileSync(
    new URL(
      "../../../packages/contracts/fixtures/hub/valid/JobPayload.agent-mcp.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as AgentCliJob;

export type SqlJob = {
  jobId: string;
  runId: string;
  flowId: string;
  convId: string;
  token: string;
};
export type SqlJobOpts = {
  who?: UserKey;
  type: "workflow.async" | "agent.cli";
  status?: "queued" | "running" | "succeeded" | "cancelled";
  /** workflow.async: workflow + key; agent.cli: agent + tools MCP. */
  workflowId?: string;
  workflowKey?: string;
  agentId?: string;
  agentKey?: string;
  tools?: string[];
  mcpUrl?: string;
  locale?: "vi" | "en";
};

/** Payload hợp `JobPayloadSchema` cho job dựng bằng SQL. */
function sqlJobPayload(
  o: SqlJobOpts,
  common: Record<string, string>,
  difyUser: string,
): Record<string, unknown> {
  if (o.type === "workflow.async")
    return {
      v: 1,
      type: "workflow.async",
      provider_key: "dify",
      ...common,
      workflow_id: o.workflowId,
      feature_id: null,
      command_id: null,
      workflow_key: o.workflowKey,
      app_type: "workflow",
      inputs: { source_text: "xin chào", target_lang: "en" },
      query: null,
      output_field: null,
      dify_user: difyUser,
      side_effect: false,
      timeout_s: 30,
    };
  return {
    ...AGENT_MCP_FIXTURE,
    ...common,
    feature_id: null,
    agent_type_key: null,
    agent: { id: o.agentId, key: o.agentKey, role: "agent" },
    provider_key: "fake-cli",
    model: null,
    profile_steps: [{ provider_key: "fake-cli", model: null, on: [] }],
    step_index: 0,
    mcp: o.tools ? { url: o.mcpUrl ?? "http://localhost:4000/mcp", tools: o.tools } : null,
  };
}

/** Cột trạng thái job theo `status` (queued: chưa claim; running: heartbeat mới; kết thúc: finished_at). */
function jobState(status: NonNullable<SqlJobOpts["status"]>) {
  const now = new Date();
  const queued = status === "queued";
  const running = status === "running";
  return {
    status,
    attempts: queued ? 0 : 1,
    worker: queued ? null : "qc-rt-sql",
    heartbeat: running ? now : null,
    started: queued ? null : now,
    finished: running || queued ? null : now,
  };
}

/**
 * Hội thoại + flow + tin + run `running` (chủ instance khác, lease 1 giờ — sweeper không chạm) + step + job có `token_hash`.
 * Payload hợp `JobPayloadSchema`. Trả token rõ (chỉ ở test).
 */
export async function insertSqlJob(sql: Sql, ids: () => string, o: SqlJobOpts): Promise<SqlJob> {
  const u = USERS[o.who ?? "lan"];
  const [convId, flowId, msgU, msgA, runId, stepId, jobId] = Array.from(
    { length: 7 },
    ids,
  ) as string[] as [string, string, string, string, string, string, string];
  await sql`insert into hub.conversations (id, tenant_id, user_id, title, title_norm)
    values (${convId}, ${u.tid}, ${u.id}, 'Job SQL', 'job sql')`;
  await sql`insert into hub.flows (id, tenant_id, user_id, conversation_id, title, message_count)
    values (${flowId}, ${u.tid}, ${u.id}, ${convId}, 'Job SQL', 2)`;
  await sql`insert into hub.messages (id, tenant_id, user_id, conversation_id, flow_id, role, content, run_id) values
    (${msgU}, ${u.tid}, ${u.id}, ${convId}, ${flowId}, 'user', 'việc thử', null),
    (${msgA}, ${u.tid}, ${u.id}, ${convId}, ${flowId}, 'assistant', '', ${runId})`;
  await sql`insert into hub.runs (id, tenant_id, user_id, conversation_id, flow_id, status, config_version,
      user_message_id, answer_message_id, owner, lease_until, locale)
    values (${runId}, ${u.tid}, ${u.id}, ${convId}, ${flowId}, 'running', 1, ${msgU}, ${msgA},
      'qc-other-instance', now() + interval '1 hour', ${o.locale ?? "vi"})`;
  const common = {
    job_id: jobId,
    run_id: runId,
    step_id: stepId,
    tenant_id: u.tid,
    user_id: u.id,
    conversation_id: convId,
    flow_id: flowId,
  };
  const payload = sqlJobPayload(o, common, `acme:${u.id}`);
  expect(JobPayloadSchema.safeParse(payload).success).toBe(true);
  const agentId = o.type === "agent.cli" ? (o.agentId ?? null) : null;
  await sql`insert into hub.run_steps (id, tenant_id, user_id, run_id, seq, type, agent_id, provider_key, job_id,
      label_key, status) values
    (${stepId}, ${u.tid}, ${u.id}, ${runId}, 1, 'delegate', ${agentId}, 'fake-cli', ${jobId}, 'step.delegate',
     'running')`;
  const token = newJobToken();
  const t = jobState(o.status ?? "running");
  await sql`insert into hub.jobs (id, tenant_id, user_id, run_id, step_id, conversation_id, agent_id, type,
      provider_key, payload, status, attempts, worker_id, heartbeat_at, started_at, finished_at, token_hash)
    values (${jobId}, ${u.tid}, ${u.id}, ${runId}, ${stepId}, ${convId}, ${agentId}, ${o.type},
      ${o.type === "workflow.async" ? "dify" : "fake-cli"}, ${sql.json(payload as never)}, ${t.status},
      ${t.attempts}, ${t.worker}, ${t.heartbeat}, ${t.started}, ${t.finished}, ${tokenHash(token)})`;
  return { jobId, runId, flowId, convId, token };
}

// ---------- gọi endpoint bằng token job ----------
export const credential = (hub: Hub, jobId: string, token?: string): Promise<Res> =>
  call(hub, "POST", `/internal/jobs/${jobId}/dify-credential`, {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });

let rpcId = 0;
/** JSON-RPC 2.0 tới `/mcp` (POST, `application/json`). */
export function mcp(hub: Hub, token: string, method: string, params?: unknown): Promise<Res> {
  rpcId++;
  return call(hub, "POST", "/mcp", {
    headers: { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream" },
    body: { jsonrpc: "2.0", id: rpcId, method, ...(params === undefined ? {} : { params }) },
  });
}
