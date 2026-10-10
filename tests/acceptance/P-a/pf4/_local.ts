// HUB-FR-116 · HUB-FR-117 · fixture usage riêng PF4 (test-plan-int §5; plan §6; plan-contract §7.1 N4): run 2 stage — stage 0
// agent làm lại 1 lần (2 `hub.runs`), stage 1 nhóm `qc-team` 1 team_run (plan + 3 thành viên trong 1 `hub.runs`); mỗi lần gọi =
// 1 `run_steps` (detail N4) + 1 `usage_logs` (step_id). SQL owner, CHỈ sau `c.ready`. Không sửa `_support/`.
import { createApp } from "../../../../apps/hub-api/src/app";
import { connectDb, pingDb } from "../../../../apps/hub-api/src/lib/db";
import { createRedis, pingRedis } from "../../../../apps/hub-api/src/lib/redis";
import { HUB_API_URL, type HubDeps, makeKeys, REDIS_TEST_URL, sign } from "../../H1/_fixtures";
import { testRedis } from "../../H1/_hub";
import { ScriptRuntime } from "../../H1/_runtime";
import { api, Q } from "../../X2a/_x2a";
import {
  AGB,
  type CtxPa,
  defInput,
  insertDef,
  insertOutput,
  insertRun,
  insertTask,
  type Json,
  PA,
  PA_FIX,
  type Role,
  type RunFix,
  setupPa,
  stageDef,
  T,
} from "../_support/pa";

type Who = { id: string; tid: string };
export const Q06 = Q[5] as (typeof Q)[number];
export const TEAM = "a5a00000-0000-4000-8000-000000040001";
export const DEF_USAGE = "a5a00000-0000-4000-8000-000000040002";

export function defUsage() {
  const d = defInput({
    key: "p-usage",
    stages: [
      stageDef({ key: "doc", after: { kind: "review", group_id: PA_FIX.gKeToan } }),
      stageDef({
        key: "nhom",
        name: "Nhóm viết",
        executor: { kind: "team", team_id: TEAM },
        after: { kind: "auto" },
      }),
    ],
  });
  return {
    id: DEF_USAGE,
    key: d.key as string,
    name: d.name as string,
    stages: d.stages as Json[],
    input: d,
  };
}
export async function seedUsageDef(c: CtxPa): Promise<void> {
  await c.sql`insert into hub.agent_teams (id, key, name, mode) values
    (${TEAM}, 'qc-team', ${c.sql.json({ vi: "Nhóm QC", en: "QC team" })}, 'sequential')`;
  await insertDef(c.sql, { id: DEF_USAGE, tenantId: T.acme, input: defUsage().input });
}

type Call = {
  role: "agent" | "plan" | "member";
  member: string | null;
  in: number;
  out: number;
  cr: number | null;
  cw: number | null;
};
/** 1 `hub.runs` (lần thử) + mỗi lần gọi 1 run_step + 1 usage_log. Trả Σ token. */
export async function insertAttempt(
  c: CtxPa,
  run: RunFix,
  by: Who,
  stageIdx: number,
  calls: Call[],
  teamRunId: string | null = null,
): Promise<number> {
  const id = crypto.randomUUID();
  const mu = crypto.randomUUID();
  const ma = crypto.randomUUID();
  await c.sql`insert into hub.messages (id, tenant_id, user_id, conversation_id, flow_id, role, content) values
    (${mu}, ${by.tid}, ${by.id}, ${run.convId}, ${run.flowId}, 'user', 'Giai đoạn'),
    (${ma}, ${by.tid}, ${by.id}, ${run.convId}, ${run.flowId}, 'assistant', 'Kết quả')`;
  await c.sql`insert into hub.runs (id, tenant_id, user_id, conversation_id, flow_id, status, config_version, user_message_id,
      answer_message_id, finished_at, process_run_id, stage_run_id, team_run_id)
    values (${id}, ${by.tid}, ${by.id}, ${run.convId}, ${run.flowId}, 'finished', 1, ${mu}, ${ma}, now(), ${run.runId},
      ${run.stageRunIds[stageIdx] as string}, ${teamRunId})`;
  let total = 0;
  for (let i = 0; i < calls.length; i++) {
    const k = calls[i] as Call;
    const stepId = crypto.randomUUID();
    await c.sql`insert into hub.run_steps ${c.sql({
      id: stepId,
      tenant_id: by.tid,
      user_id: by.id,
      run_id: id,
      seq: i + 1,
      type: "delegate",
      agent_id: AGB.hoadon,
      label_key: `process.${k.role}`,
      status: "ok",
      detail: c.sql.json({
        process_run_id: run.runId,
        stage_run_id: run.stageRunIds[stageIdx] as string,
        team_run_id: teamRunId,
        member_key: k.member,
        role: k.role,
      }),
    })}`;
    await c.sql`insert into hub.usage_logs (tenant_id, run_id, step_id, user_id, agent_id, provider_key, model, billing,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, latency_ms, job_id, at)
      values (${by.tid}, ${id}, ${stepId}, ${by.id}, ${AGB.hoadon}, 'fake-cli', 'claude-sonnet', 'subscription', ${k.in},
        ${k.out}, ${k.cr}, ${k.cw}, 1500, ${crypto.randomUUID()}, now())`;
    total += k.in + k.out + (k.cr ?? 0) + (k.cw ?? 0);
  }
  return total;
}

export type UsageFix = {
  run: RunFix;
  total: number;
  teamRunId: string;
  reviewTask: string;
  askTask: string;
};
/** Run test-plan-int §5 + ma trận §6: `waiting_review` stage 0 (attempt 2), task review Group Kế toán (+T chuyển),
 *  task ask đã đóng (A → H); stage 0 hai lần thử, stage 1 nhóm (plan + m1..m3). */
export async function usageRun(c: CtxPa, by: Who = PA.A): Promise<UsageFix> {
  const d = defUsage();
  const run = await insertRun(c.sql, {
    def: d,
    startedBy: by,
    roomId: PA_FIX.room,
    status: "waiting_review",
  });
  const [sr0, sr1] = run.stageRunIds as [string, string];
  await c.sql`update hub.stage_runs set attempt = 2 where id = ${sr0}`;
  const call = (role: Call["role"], member: string | null, n: number): Call => ({
    role,
    member,
    in: 100 * n,
    out: 10 * n,
    cr: n % 2 ? 5 : null,
    cw: n % 3 ? null : 2,
  });
  let total = await insertAttempt(c, run, by, 0, [call("agent", null, 1)]);
  total += await insertAttempt(c, run, by, 0, [call("agent", null, 2)]);
  const [tr] = await c.sql<
    Json[]
  >`insert into hub.team_runs (tenant_id, stage_run_id, process_run_id, attempt, team_id, mode,
      cursor, status, calls, tokens, active_ms)
    values (${by.tid}, ${sr1}, ${run.runId}, 1, ${TEAM}, 'sequential', 3, 'done', 4, 0, 4200) returning id`;
  total += await insertAttempt(
    c,
    run,
    by,
    1,
    [
      call("plan", null, 3),
      call("member", "m1", 4),
      call("member", "m2", 5),
      call("member", "m3", 6),
    ],
    tr?.id,
  );
  const outputId = await insertOutput(c.sql, {
    tid: by.tid,
    runId: run.runId,
    stageRunId: sr0,
    stageIdx: 0,
  });
  const reviewTask = await insertTask(c.sql, {
    tid: by.tid,
    runId: run.runId,
    stageRunId: sr0,
    kind: "review",
    outputId,
    groupId: PA_FIX.gKeToan,
  });
  const askTask = await insertTask(c.sql, {
    tid: by.tid,
    runId: run.runId,
    stageRunId: sr0,
    kind: "ask",
    userIds: [by.id],
    status: "closed",
  });
  await c.sql`insert into hub.review_task_assignees (tenant_id, task_id, user_id, via, from_user_id, depth) values
    (${by.tid}, ${askTask}, ${PA.H.id}, 'forward', ${by.id}, 1),
    (${by.tid}, ${reviewTask}, ${PA.T.id}, 'forward', ${PA.B.id}, 1)`;
  return { run, total, teamRunId: tr?.id, reviewTask, askTask };
}

/** Σ(in+out+cr+cw) usage_logs của mọi `hub.runs` có `process_run_id` (nguồn thật, plan §6). */
export async function usageSum(
  c: CtxPa,
  processRunId: string,
): Promise<{ total: number; calls: number }> {
  const [r] = await c.sql<
    Json[]
  >`select coalesce(sum(ul.input_tokens + ul.output_tokens + coalesce(ul.cache_read_tokens, 0)
      + coalesce(ul.cache_write_tokens, 0)), 0)::int as total, count(*)::int as calls
    from hub.usage_logs ul join hub.runs r on r.id = ul.run_id where r.process_run_id = ${processRunId}`;
  return { total: r?.total ?? -1, calls: r?.calls ?? -1 };
}

export async function callQ06(c: CtxPa, method: string, path: string) {
  return api(c.hub, await sign(c.k, Q06), method, path);
}

/** Hub thật + launcher PF1 thật (không `stageLauncher` giả) — ca ⇢PF1 (P4-07). */
export async function startPaReal(): Promise<CtxPa> {
  const { sql, ready } = await setupPa();
  const k = await makeKeys();
  const db = connectDb(HUB_API_URL, 8);
  const redis = createRedis(REDIS_TEST_URL);
  await redis.connect();
  const ac = new AbortController();
  let handles: Json | null = null;
  const deps = {
    probes: [() => pingDb(db), () => pingRedis(redis)],
    db,
    redis,
    jwtPublicKey: k.publicKey,
    appEnv: "test",
    instanceId: "qc-pa-pf4",
    signal: ac.signal,
    pingMs: 500,
    jobMaxWaitS: 30,
    maxConcurrentRuns: 2,
    processEngine: true,
    processLoops: false,
    onProcessHandles: (h: Json) => {
      handles = h;
    },
  } as HubDeps & Record<string, unknown>;
  const app = createApp({ version: "0.0.0-test", corsOrigins: ["http://localhost:3100"] }, deps);
  const server = Bun.serve({ port: 0, fetch: app.fetch, idleTimeout: 0 });
  const hub = {
    base: `http://localhost:${server.port}`,
    db,
    redis,
    instanceId: "qc-pa-pf4",
    handles: () => handles,
    kicks: [] as string[],
    stop: async () => {
      ac.abort();
      await server.stop(true);
      redis.disconnect();
      await db.close();
    },
  };
  const r2 = await testRedis();
  const tok = (r: Role) => sign(k, PA[r]);
  return {
    sql,
    ready,
    k,
    hub,
    redis: r2,
    rt: new ScriptRuntime(sql, r2),
    tok,
    call: async (r, method, path, body) => api(hub, await tok(r), method, path, body),
    stop: async () => {
      await hub.stop();
      r2.disconnect();
      await sql.end();
    },
  } as CtxPa;
}
