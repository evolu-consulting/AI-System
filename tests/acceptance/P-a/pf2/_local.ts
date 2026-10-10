// HUB-FR-110 · HUB-FR-111 · fixture riêng PF2 (test-plan-int §3): run `waiting_answer` origin R + task ask / review / decision
// bằng SQL owner (không cần PF1). CHỈ gọi sau `c.ready` (0019 có). `startPaReal` = hub thật KHÔNG có `stageLauncher` giả
// (launcher PF1) — chỉ cho ca ⇢PF1. Không sửa `_support/`.
import { createApp } from "../../../../apps/hub-api/src/app";
import { connectDb, pingDb } from "../../../../apps/hub-api/src/lib/db";
import { createRedis, pingRedis } from "../../../../apps/hub-api/src/lib/redis";
import { HUB_API_URL, type HubDeps, makeKeys, REDIS_TEST_URL, sign } from "../../H1/_fixtures";
import { testRedis } from "../../H1/_hub";
import { ScriptRuntime } from "../../H1/_runtime";
import { api } from "../../X2a/_x2a";
import {
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
  T,
} from "../_support/pa";

type Who = { id: string; tid: string };

/** Def `hoa-don-t` (acme), stage 0 review Group Kế toán (snapshot giống `process_defs`). */
export function defKT(answerer: Json = { kind: "starter" }) {
  const d = defInput({ groupId: PA_FIX.gKeToan });
  const stages = (d.stages as Json[]).map((s, i) => (i === 0 ? { ...s, answerer } : s));
  return { id: PA_FIX.defHoaDon, key: d.key as string, name: d.name as string, stages };
}
export async function seedDef(c: CtxPa): Promise<void> {
  await insertDef(c.sql, {
    id: PA_FIX.defHoaDon,
    tenantId: T.acme,
    input: defInput({ groupId: PA_FIX.gKeToan }),
  });
}

export type AskFix = { run: RunFix; taskId: string };
/** Run `waiting_answer` stage 0 (asks_count 1) + task ask open gán `userIds` (mặc định người bắt đầu). */
export async function askRun(
  c: CtxPa,
  o: {
    by?: Who;
    roomId?: string | null;
    userIds?: string[];
    groupId?: string | null;
    status?: "open" | "closed";
  } = {},
): Promise<AskFix> {
  const by = o.by ?? PA.A;
  const run = await insertRun(c.sql, {
    def: defKT(o.groupId ? { kind: "group", group_id: o.groupId } : { kind: "starter" }),
    startedBy: by,
    roomId: o.roomId === undefined ? PA_FIX.room : o.roomId,
    status: "waiting_answer",
  });
  await c.sql`update hub.stage_runs set asks_count = 1 where id = ${run.stageRunIds[0] as string}`;
  const taskId = await insertTask(c.sql, {
    tid: by.tid,
    runId: run.runId,
    stageRunId: run.stageRunIds[0] as string,
    kind: "ask",
    question: "Kỳ kế toán nào?",
    userIds: o.groupId ? [] : (o.userIds ?? [by.id]),
    groupId: o.groupId ?? null,
    status: o.status,
  });
  await c.sql`update hub.review_tasks set excerpt = 'HD-12 tháng 9', choices = ${c.sql.json(["Tháng 9", "Tháng 10"])}
    where id = ${taskId}`;
  return { run, taskId };
}

/** Run `waiting_review` stage 0 + output + task review open gán Group Kế toán. */
export async function reviewRun(c: CtxPa, by: Who = PA.A): Promise<AskFix & { outputId: string }> {
  const run = await insertRun(c.sql, {
    def: defKT(),
    startedBy: by,
    roomId: PA_FIX.room,
    status: "waiting_review",
  });
  const outputId = await insertOutput(c.sql, {
    tid: by.tid,
    runId: run.runId,
    stageRunId: run.stageRunIds[0] as string,
    stageIdx: 0,
  });
  const taskId = await insertTask(c.sql, {
    tid: by.tid,
    runId: run.runId,
    stageRunId: run.stageRunIds[0] as string,
    kind: "review",
    outputId,
    groupId: PA_FIX.gKeToan,
  });
  return { run, taskId, outputId };
}

/** Run `needs_decision redo_limit` + task decision open gán A. */
export async function decisionRun(c: CtxPa): Promise<AskFix> {
  const run = await insertRun(c.sql, {
    def: defKT(),
    startedBy: PA.A,
    roomId: PA_FIX.room,
    status: "needs_decision",
    decision: {
      reason: "redo_limit",
      stage_idx: 0,
      options: ["add_attempt", "use_current", "cancel"],
    },
  });
  const taskId = await insertTask(c.sql, {
    tid: T.acme,
    runId: run.runId,
    stageRunId: run.stageRunIds[0] as string,
    kind: "decision",
    reason: "redo_limit",
    userIds: [PA.A.id],
  });
  return { run, taskId };
}

/** Thêm assignee `via=forward` bằng SQL (dựng sẵn chuỗi chuyển, không qua route). */
export async function addForward(
  c: CtxPa,
  taskId: string,
  from: Who,
  to: Who,
  depth: number,
): Promise<void> {
  await c.sql`insert into hub.review_task_assignees (tenant_id, task_id, user_id, via, from_user_id, depth)
    values (${T.acme}, ${taskId}, ${to.id}, 'forward', ${from.id}, ${depth})`;
}

export async function taskRow(c: CtxPa, id: string): Promise<Json> {
  const [r] = await c.sql<
    Json[]
  >`select status, result, answer, decided_by from hub.review_tasks where id = ${id}`;
  return r ?? null;
}
export async function assignees(c: CtxPa, id: string): Promise<Json[]> {
  return c.sql<
    Json[]
  >`select user_id, group_id, via, from_user_id, note, depth from hub.review_task_assignees
    where task_id = ${id} order by depth, created_at`;
}
export async function stageStatus(c: CtxPa, stageRunId: string): Promise<string | null> {
  const [r] = await c.sql<Json[]>`select status from hub.stage_runs where id = ${stageRunId}`;
  return r?.status ?? null;
}
export async function audits(c: CtxPa, entityId: string, action: string): Promise<Json[]> {
  return c.sql<
    Json[]
  >`select actor_id, entity from hub.audit_log where entity_id = ${entityId} and action = ${action}`;
}
export const answer = (c: CtxPa, r: Role, taskId: string, body: Json = { answer: "Tháng 9" }) =>
  c.call(r, "POST", `/review-tasks/${taskId}/answer`, body);
export const forward = (c: CtxPa, r: Role, taskId: string, to: string, note?: string) =>
  c.call(
    r,
    "POST",
    `/review-tasks/${taskId}/forward`,
    note === undefined ? { to_user_id: to } : { to_user_id: to, note },
  );

/** Hub thật + launcher PF1 thật (không `stageLauncher` giả) — ca ⇢PF1 (P2-04 phần job, P2-11). */
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
    instanceId: "qc-pa-pf2",
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
    instanceId: "qc-pa-pf2",
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
