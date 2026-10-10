// HUB-FR-105…116 · PF1 · helper riêng thư mục pf1 (test-plan §1: mỗi PF chỉ import `_support/` + file thư mục mình).
// Khác `startPa` (`_support/pa.ts`): `stageLauncher` THẬT (vắng ⇒ launcher PF1 chạy stage) — PF1 cần stage chạy qua
// runtime giả claim `hub.jobs` (ScriptRuntime H1). `processLoops:false` mặc định (test gọi `sweepOnce`/`postThreadOnce`).
// Seed PF1 (`seedPf1`) chèn bảng 0019 (`agent_teams`, `process_defs`…) ⇒ CHỈ gọi khi `ready` (test-plan §5).
// Không chứa `it(...)`. Mọi jsonb qua `sql.json`, mảng uuid qua `sql.array(…, 2950)` (CONVENTIONS §2 bẫy).
import { expect } from "bun:test";
import { createApp } from "../../../../apps/hub-api/src/app";
import { connectDb, pingDb } from "../../../../apps/hub-api/src/lib/db";
import { createRedis, pingRedis } from "../../../../apps/hub-api/src/lib/redis";
import { HUB_API_URL, type HubDeps, makeKeys, REDIS_TEST_URL, sign } from "../../H1/_fixtures";
import { testRedis } from "../../H1/_hub";
import { type Job, ScriptRuntime } from "../../H1/_runtime";
import { openMeStream } from "../../X2a/_x2a";
import {
  AGB,
  api,
  type CtxPa,
  type HubPa,
  type Json,
  PA,
  PA_FIX,
  type PaOpts,
  postRoom,
  type Role,
  type Sql,
  setupPa,
  stageDef,
  T,
  waitFor,
} from "../_support/pa";

export { type Job, openMeStream };

const x = (n: number) => `a5a10000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** Id cố định PF1 (dải `a5a1…`). */
export const P1 = {
  gRun: x(1), // Group "Người chạy" (acme): lan, tadmin — `run_group_ids` của `hoa-don-t` (P1-10: X không thấy)
  agRead: x(11), // `hd-read` (stage 1 hoá đơn)
  agPost: x(12), // `hd-post` (stage 2, real_action `ghi-so`)
  agM1: x(13),
  agM2: x(14),
  agM3: x(15),
  agLead: x(16),
  teamQc: x(21), // `qc-team` sequential m1/m2/m3 "Phần A/B/C"
  teamLead: x(22), // `lead-team` lead_plan (lead = agLead)
  teamPm: x(23), // `pm-team` parallel_merge m1/m2
  defTeam: x(31), // `p-team` (stage nhóm qc-team, review Kế toán)
  defLead: x(32), // `p-lead`
  defPm: x(33), // `p-pm`
  defSingle: x(34), // `p-single` (stage agent đơn hd-read, auto) — P1-36(d)
} as const;

// ---------- template + nội dung runtime ----------
export const HD_TEMPLATE = "## Bảng ý\n\n## Tổng tiền\n";
export const MD_OK = "## Bảng ý\nHoá đơn HD-12 tháng 9.\n\n## Tổng tiền\n12 000 000";
export const MD_MISSING = "## Bảng ý\nHoá đơn HD-12 tháng 9."; // thiếu `## Tổng tiền` (M3)
export const TEAM_TEMPLATE = "## Phần A\n\n## Phần B\n\n## Phần C\n";

const hdStages = (): Json[] => [
  stageDef({
    key: "doc",
    executor: { kind: "agent", agent_id: P1.agRead },
    output: {
      filename: "hoa-don.md",
      template: HD_TEMPLATE,
      required_sections: ["Bảng ý", "Tổng tiền"],
      fields: [],
    },
    after: { kind: "review", group_id: PA_FIX.gKeToan },
  }),
  stageDef({
    key: "ghi",
    name: "Ghi sổ",
    executor: { kind: "agent", agent_id: P1.agPost },
    output: {
      filename: "ghi-so.md",
      template: "## Kết quả\n",
      required_sections: ["Kết quả"],
      fields: [],
    },
    after: { kind: "auto" },
    real_action: true,
  }),
];
const teamStage = (teamId: string): Json =>
  stageDef({
    key: "nhom",
    name: "Soạn tài liệu",
    executor: { kind: "team", team_id: teamId },
    output: {
      filename: "tai-lieu.md",
      template: TEAM_TEMPLATE,
      required_sections: ["Phần A", "Phần B", "Phần C"],
      fields: [],
    },
    after: { kind: "review", group_id: PA_FIX.gKeToan },
  });

/** Def PF1 (key, stages) — dùng khi chèn run bằng SQL (`insertRun`). */
export const DEFS = {
  hd: { id: PA_FIX.defHoaDon, key: "hoa-don-t", name: "Hoá đơn thử", stages: hdStages() },
  auto: {
    id: PA_FIX.defAuto,
    key: "p-auto",
    name: "Tự động thử",
    stages: [
      stageDef({
        key: "a1",
        executor: { kind: "agent", agent_id: P1.agRead },
        after: { kind: "auto" },
      }),
      stageDef({
        key: "a2",
        executor: { kind: "agent", agent_id: P1.agRead },
        after: { kind: "auto" },
      }),
    ],
  },
  team: { id: P1.defTeam, key: "p-team", name: "Nhóm thử", stages: [teamStage(P1.teamQc)] },
  lead: {
    id: P1.defLead,
    key: "p-lead",
    name: "Nhóm trưởng thử",
    stages: [teamStage(P1.teamLead)],
  },
  pm: { id: P1.defPm, key: "p-pm", name: "Nhóm song song thử", stages: [teamStage(P1.teamPm)] },
  single: {
    id: P1.defSingle,
    key: "p-single",
    name: "Agent đơn thử",
    stages: [
      stageDef({
        key: "s1",
        executor: { kind: "agent", agent_id: P1.agRead },
        after: { kind: "auto" },
      }),
    ],
  },
} as const;

/** Chèn def (có `run_group_ids`, `enabled`, `deleted_at`). */
export async function insertDefPf1(
  sql: Sql,
  d: { id: string; key: string; name: string; stages: readonly Json[] },
  o: {
    tenantId?: string | null;
    runGroupIds?: string[];
    enabled?: boolean;
    deleted?: boolean;
    tokenBudget?: number | null;
  } = {},
): Promise<void> {
  await sql`insert into hub.process_defs (id, tenant_id, key, name, description, input_hint, run_group_ids, stages,
      token_budget, enabled, version, deleted_at)
    values (${d.id}, ${o.tenantId === undefined ? T.acme : o.tenantId}, ${d.key}, ${d.name}, '', 'Số hoá đơn',
      ${sql.array(o.runGroupIds ?? [], 2950)}, ${sql.json(d.stages as Json[])}, ${o.tokenBudget ?? null},
      ${o.enabled ?? true}, 1, ${o.deleted ? new Date() : null})`;
}

async function insertAgents(sql: Sql): Promise<void> {
  const [p] = await sql<
    { profile_id: string }[]
  >`select profile_id from hub.agents where id = ${AGB.hoadon}`;
  const ag = (id: string, key: string, vi: string) => ({
    id,
    key,
    name: sql.json({ vi, en: vi }),
    description: `Agent thử ${key}.`,
    runtime: "agentic-cli",
    profile_id: p?.profile_id,
    system_prompt: "",
  });
  await sql`insert into hub.agents ${sql([
    ag(P1.agRead, "hd-read", "Đọc hoá đơn"),
    ag(P1.agPost, "hd-post", "Ghi sổ"),
    ag(P1.agM1, "m1", "Thành viên 1"),
    ag(P1.agM2, "m2", "Thành viên 2"),
    ag(P1.agM3, "m3", "Thành viên 3"),
    ag(P1.agLead, "lead1", "Trưởng nhóm"),
  ])}`;
  const all = [P1.agRead, P1.agPost, P1.agM1, P1.agM2, P1.agM3, P1.agLead];
  await sql`insert into hub.agent_entitlements ${sql(all.map((agent_id) => ({ agent_id, tenant_id: T.acme })))}`;
  // A có grant hd-read + hd-post (KHÔNG có grant m1–m3, lead1 — C2: stage nhóm không kiểm grant thành viên).
  await sql`insert into hub.agent_grants ${sql(
    [P1.agRead, P1.agPost].map((agent_id) => ({
      agent_id,
      tenant_id: T.acme,
      subject_type: "user",
      subject_id: PA.A.id,
    })),
  )}`;
  await sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
}

async function insertTeams(sql: Sql): Promise<void> {
  const team = (id: string, key: string, mode: string, lead: string | null) => ({
    id,
    key,
    name: sql.json({ vi: key, en: key }),
    description: "",
    mode,
    lead_agent_id: lead,
    limits: sql.json({
      max_calls: 10,
      max_tokens: 200000,
      max_active_s: 600,
      summary_tokens: 200,
      max_plan_steps: 5,
    }),
    enabled: true,
  });
  await sql`insert into hub.agent_teams ${sql([
    team(P1.teamQc, "qc-team", "sequential", null),
    team(P1.teamLead, "lead-team", "lead_plan", P1.agLead),
    team(P1.teamPm, "pm-team", "parallel_merge", null),
  ])}`;
  const mem = (team_id: string, agent_id: string, role: string, s: string, position: number) => ({
    team_id,
    agent_id,
    role,
    sections: sql.array([s]),
    position,
  });
  await sql`insert into hub.agent_team_members ${sql([
    mem(P1.teamQc, P1.agM1, "Phân tích", "Phần A", 0),
    mem(P1.teamQc, P1.agM2, "Thiết kế", "Phần B", 1),
    mem(P1.teamQc, P1.agM3, "Kiểm thử", "Phần C", 2),
    mem(P1.teamLead, P1.agM1, "Phân tích", "Phần A", 0),
    mem(P1.teamLead, P1.agM2, "Thiết kế", "Phần B", 1),
    mem(P1.teamLead, P1.agM3, "Kiểm thử", "Phần C", 2),
    mem(P1.teamPm, P1.agM1, "Phân tích", "Phần A", 0),
    mem(P1.teamPm, P1.agM2, "Thiết kế", "Phần B", 1),
  ])}`;
  await sql`insert into hub.agent_team_entitlements ${sql(
    [P1.teamQc, P1.teamLead, P1.teamPm].map((team_id) => ({ team_id, tenant_id: T.acme })),
  )}`;
}

/** Seed PF1 (chỉ khi `ready`): Group "Người chạy", agent, nhóm, def acme + def beta `hoa-don-t`. */
export async function seedPf1(sql: Sql): Promise<void> {
  await sql`insert into admin.groups (id, tenant_id, key, name)
    values (${P1.gRun}, ${T.acme}, 'nguoi-chay', ${sql.json({ vi: "Người chạy", en: "Runners" })})`;
  await sql`insert into admin.group_members ${sql([
    { tenant_id: T.acme, group_id: P1.gRun, user_id: PA.A.id },
    { tenant_id: T.acme, group_id: P1.gRun, user_id: PA.Adm.id },
  ])}`;
  await insertAgents(sql);
  await insertTeams(sql);
  await insertDefPf1(sql, DEFS.hd, { runGroupIds: [P1.gRun] });
  await insertDefPf1(sql, DEFS.auto);
  await insertDefPf1(sql, DEFS.team);
  await insertDefPf1(sql, DEFS.lead);
  await insertDefPf1(sql, DEFS.pm);
  await insertDefPf1(sql, DEFS.single);
  await insertDefPf1(
    sql,
    { ...DEFS.hd, id: PA_FIX.defBeta, stages: hdStages() },
    { tenantId: T.beta },
  );
}

// ---------- hub-api thật, launcher thật ----------
export type Pf1Opts = PaOpts & {
  /** true ⇒ `stageLauncher` giả ghi runId (không chạy stage); mặc định false = launcher PF1 thật. */
  fakeLauncher?: boolean;
  /** vắng ⇒ false (test gọi *Once); P1-81(c) truyền `undefined` qua `loops: true` ⇒ vòng nền chạy. */
  loops?: boolean;
  /** không seed PF1 (ca tự dựng). */
  noSeed?: boolean;
};
export type CtxPf1 = CtxPa;

async function startHub(k: Awaited<ReturnType<typeof makeKeys>>, o: Pf1Opts): Promise<HubPa> {
  const db = connectDb(HUB_API_URL, 8);
  const redis = createRedis(REDIS_TEST_URL);
  await redis.connect();
  const ac = new AbortController();
  const instanceId = o.instanceId ?? "qc-pf1-1";
  let handles: Json | null = null;
  const kicks: string[] = [];
  const deps: Record<string, unknown> = {
    probes: [() => pingDb(db), () => pingRedis(redis)],
    db,
    redis,
    jwtPublicKey: k.publicKey,
    appEnv: "test",
    instanceId,
    signal: ac.signal,
    pingMs: 500,
    jobMaxWaitS: 30,
    maxConcurrentRuns: 4,
    processEngine: o.flag ?? true,
    processRunsPerTenant: o.processRunsPerTenant,
    now: o.now,
    onProcessHandles: (h: Json) => {
      handles = h;
    },
  };
  if (!o.loops) deps.processLoops = false;
  if (o.fakeLauncher)
    deps.stageLauncher = {
      kick: async (runId: string) => {
        kicks.push(runId);
      },
    };
  const app = createApp(
    { version: "0.0.0-test", corsOrigins: ["http://localhost:3100"] },
    deps as HubDeps & Record<string, unknown>,
  );
  const server = Bun.serve({ port: 0, fetch: app.fetch, idleTimeout: 0 });
  return {
    base: `http://localhost:${server.port}`,
    db,
    redis,
    instanceId,
    handles: () => handles,
    kicks,
    stop: async () => {
      ac.abort();
      await server.stop(true);
      redis.disconnect();
      await db.close();
    },
  };
}

/** DB sạch + persona P-a + (ready ⇒ seed PF1) + hub-api launcher thật. */
export async function startPf1(o: Pf1Opts = {}): Promise<CtxPf1> {
  const { sql, ready } = await setupPa();
  if (ready && !o.noSeed) await seedPf1(sql);
  const k = await makeKeys();
  const hub = await startHub(k, o);
  const redis = await testRedis();
  const rt = new ScriptRuntime(sql, redis);
  const tok = (r: Role) => sign(k, PA[r]);
  return {
    sql,
    ready,
    k,
    hub,
    redis,
    rt,
    tok,
    call: async (r, method, path, body) => api(hub, await tok(r), method, path, body),
    stop: async () => {
      await hub.stop();
      redis.disconnect();
      await sql.end();
    },
  };
}

/** Hub thứ hai cùng DB (P1-63: 2 instance). */
export async function secondHub(c: CtxPf1, o: Pf1Opts = {}): Promise<HubPa> {
  return startHub(c.k, { instanceId: "qc-pf1-2", ...o });
}

// ---------- seam N3 ----------
/** `ProcessHandles` (vắng ⇒ đỏ ở expect). */
export function handles(c: CtxPf1): Json {
  const h = c.hub.handles();
  expect({ handles: typeof h?.sweepOnce }).toEqual({ handles: "function" });
  return h as Json;
}
export const postThread = (c: CtxPf1): Promise<number> => handles(c).postThreadOnce();
export const sweep = (c: CtxPf1): Promise<Json> => handles(c).sweepOnce();

// ---------- bắt đầu run ----------
/** A gửi `!<key> <input>` ở phòng R; đòi 201 + `X-Process-Run-Id`. */
export async function startInRoom(
  c: CtxPf1,
  o: { role?: Role; key?: string; input?: string; roomId?: string } = {},
): Promise<{ runId: string; flowId: string; messageId: string; res: Json }> {
  const s = await postRoom(c, o.role ?? "A", o.roomId ?? PA_FIX.room, {
    content: `!${o.key ?? "hoa-don-t"} ${o.input ?? "HD-12 tháng 9"}`,
  });
  expect(s.res.status).toBe(201);
  expect(s.processRunId).toBeTruthy();
  return {
    runId: s.processRunId as string,
    flowId: s.flowId as string,
    messageId: s.res.json?.id,
    res: s.res,
  };
}
/** `POST /process-runs` (nút ▶ Quy trình / origin none). */
export async function startApi(
  c: CtxPf1,
  o: { role?: Role; key?: string; input?: string; origin?: Json } = {},
) {
  return c.call(o.role ?? "A", "POST", "/process-runs", {
    process_key: o.key ?? "hoa-don-t",
    input: o.input ?? "HD-12 tháng 9",
    origin: o.origin ?? { kind: "none" },
  });
}

// ---------- runtime giả cho stage ----------
/** `hub.runs` của process run (theo thứ tự tạo). Cột 0019 ⇒ chỉ gọi khi ready. */
export const stageHubRuns = (sql: Sql, processRunId: string) =>
  sql<Json[]>`select id, user_id, status, stage_run_id, team_run_id from hub.runs
    where process_run_id = ${processRunId} order by started_at, id`;

/** Chờ job `queued` kế của process run rồi claim (Hub chưa tạo ⇒ đỏ ở expect). */
export async function nextStageJob(c: CtxPf1, processRunId: string, ms = 8_000): Promise<Job> {
  const row = await waitFor(
    async () =>
      (
        await c.sql<
          { run_id: string }[]
        >`select j.run_id from hub.jobs j join hub.runs r on r.id = j.run_id
          where r.process_run_id = ${processRunId} and j.status = 'queued' order by j.created_at limit 1`
      )[0],
    (v) => v !== undefined,
    ms,
  );
  expect({ queuedJob: row !== undefined }).toEqual({ queuedJob: true });
  return c.rt.next((row as { run_id: string }).run_id);
}
/** Không có job mới trong `ms` (ca "0 job"). */
export async function noStageJob(c: CtxPf1, processRunId: string, ms = 1_500): Promise<boolean> {
  const row = await waitFor(
    async () =>
      (
        await c.sql<
          { n: number }[]
        >`select count(*)::int as n from hub.jobs j join hub.runs r on r.id = j.run_id
          where r.process_run_id = ${processRunId} and j.status = 'queued'`
      )[0]?.n ?? 0,
    (n) => n > 0,
    ms,
  );
  return row === 0;
}

/** Như Runtime thật: 1 dòng `usage_logs` (user = người Hub giao, step_id payload). */
export async function usage(c: CtxPf1, job: Job, input = 100, output = 20): Promise<void> {
  const p = job.payload;
  await c.sql`insert into hub.usage_logs (tenant_id, run_id, step_id, user_id, feature_id, agent_id, provider_key,
      model, billing, input_tokens, output_tokens, cost_usd, overage, latency_ms, job_id)
    values (${p.tenant_id}, ${p.run_id}, ${p.step_id}, ${p.user_id}, null, ${p.agent.id}, ${p.provider_key},
      null, 'subscription', ${input}, ${output}, 0, false, 10, ${job.id})
    on conflict (job_id) where job_id is not null do nothing`;
}
export async function jobDone(
  c: CtxPf1,
  job: Job,
  text = MD_OK,
  tok?: { input: number; output: number },
) {
  await usage(c, job, tok?.input, tok?.output);
  await c.rt.agent(job, { status: "done", text });
}
export async function jobAsk(c: CtxPf1, job: Job, question: string, choices: string[] = []) {
  await usage(c, job);
  await c.rt.agent(job, { status: "need_input", question, choices });
}
export async function jobFail(
  c: CtxPf1,
  job: Job,
  code: "TIMEOUT" | "INTERNAL_ERROR" = "INTERNAL_ERROR",
) {
  await c.rt.fail(job, code, "lỗi thử", null, code === "TIMEOUT" ? "timed_out" : "failed");
}

// ---------- đọc trạng thái ----------
export async function runRow(sql: Sql, id: string): Promise<Json> {
  return (await sql<Json[]>`select * from hub.process_runs where id = ${id}`)[0];
}
export async function stageRow(sql: Sql, runId: string, idx: number): Promise<Json> {
  return (
    await sql<
      Json[]
    >`select * from hub.stage_runs where process_run_id = ${runId} and stage_idx = ${idx}`
  )[0];
}
export async function waitStatus(sql: Sql, id: string, status: string, ms = 8_000): Promise<Json> {
  const r = await waitFor(
    () => runRow(sql, id),
    (v) => v?.status === status,
    ms,
  );
  expect(r?.status).toBe(status);
  return r;
}
export async function openTask(sql: Sql, runId: string, kind: string): Promise<Json | undefined> {
  return (
    await sql<
      Json[]
    >`select * from hub.review_tasks where process_run_id = ${runId} and kind = ${kind}
      and status = 'open' order by created_at desc limit 1`
  )[0];
}
export const outputs = (sql: Sql, runId: string) =>
  sql<
    Json[]
  >`select * from hub.process_outputs where process_run_id = ${runId} order by stage_idx, version`;
/** Tin `process` của run (theo `seq`). */
export const procMsgs = (sql: Sql, runId: string) =>
  sql<
    Json[]
  >`select id, seq, placement, sender_type, process_kind, process_meta, flow_id from hub.room_messages
    where process_run_id = ${runId} and sender_type = 'process' order by seq`;

/** A bắt đầu `hoa-don-t` ở R, runtime trả MD_OK ⇒ run `waiting_review` (gate 1). */
export async function toGate(
  c: CtxPf1,
  o: { text?: string } = {},
): Promise<{ runId: string; flowId: string; taskId: string; outputId: string; job: Job }> {
  const s = await startInRoom(c);
  const job = await nextStageJob(c, s.runId);
  await jobDone(c, job, o.text ?? MD_OK);
  await waitStatus(c.sql, s.runId, "waiting_review");
  const t = await openTask(c.sql, s.runId, "review");
  expect(t).toBeDefined();
  return { runId: s.runId, flowId: s.flowId, taskId: t?.id, outputId: t?.output_id, job };
}
/** `POST /review-tasks/:id/decision`. */
export const review = (c: CtxPf1, r: Role, taskId: string, body: Json) =>
  c.call(r, "POST", `/review-tasks/${taskId}/decision`, body);
