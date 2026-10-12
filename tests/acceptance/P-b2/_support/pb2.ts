// HUB-FR-104 · HUB-FR-106 · HUB-FR-118 · HUB-FR-136 · hạ tầng int P-b2 (test-plan §1): dùng lại `startPf1` (hub-api thật
// in-process, launcher thật, Runtime GIẢ `ScriptRuntime` claim `hub.jobs`) + seed P-a/PF1, thêm Group "Kiểm thử" (chỉ T),
// grant A cho agent m1–m3 và các def P-b2 (chèn SQL, KHÔNG qua `ensureHandoff`). Cột/bảng 0024 vắng ⇒ `pb2=false` ⇒ ca đỏ ở
// `needPb2` (không PostgresError ở beforeAll). Không chứa `it(...)`. jsonb qua `sql.json`, mảng uuid qua `sql.array(…, 2950)`.
import { expect } from "bun:test";
import type { Job } from "../../H1/_runtime";
import { PA, PA_FIX, type Role, type Sql, T, waitFor } from "../../P-a/_support/pa";
import {
  type CtxPf1,
  insertDefPf1,
  jobDone,
  P1,
  type Pf1Opts,
  review,
  runRow,
  stageRow,
  startInRoom,
  startPf1,
  waitStatus,
} from "../../P-a/pf1/_local";
import { type Json, MD_HO, pb2Id, type StageOpt, st } from "./stages";

export * from "./stages";
export {
  type Job,
  jobDone,
  P1,
  PA,
  PA_FIX,
  type Role,
  review,
  runRow,
  type Sql,
  stageRow,
  startInRoom,
  T,
  waitFor,
  waitStatus,
};

export const PB2 = {
  gTest: pb2Id(1), // Group "Kiểm thử" (acme): CHỈ T (cuc) — người duyệt 2
  par: pb2Id(31),
  back: pb2Id(32),
  auto3: pb2Id(33),
  real: pb2Id(34),
  team0: pb2Id(35),
  team0p: pb2Id(36),
  same: pb2Id(37),
  par2: pb2Id(38),
  par3: pb2Id(39),
  seqSame: pb2Id(40),
  full: pb2Id(41),
} as const;

const KT = PA_FIX.gKeToan;
const s = (o: StageOpt) => st(o, P1.agRead);
const TEAM_SEC = ["Phần A", "Phần B"];

/** Def P-b2 (test-plan §1). Tên stage = nhãn tiếng Việt dùng trong assert. */
export const DEFS2 = {
  par: {
    id: PB2.par,
    key: "pb2-par",
    name: "Song song",
    stages: [
      s({ key: "phan-tich", name: "Phân tích", step: 0, agent: P1.agPost, review: KT }),
      s({ key: "ra-soat", name: "Rà soát code", step: 1, agent: P1.agM1, review: KT }),
      s({
        key: "hoi-quy",
        name: "Test hồi quy",
        step: 1,
        agent: P1.agM2,
        review: PB2.gTest,
        back: [0],
      }),
      s({ key: "tong-hop", name: "Tổng hợp", step: 2, agent: P1.agPost, review: KT, back: [0, 1] }),
    ],
  },
  back: {
    id: PB2.back,
    key: "pb2-back",
    name: "Quay lại",
    stages: [
      s({ key: "b0", name: "B0", step: 0 }),
      s({ key: "b1", name: "B1", step: 1, agent: P1.agM1, review: KT }),
      s({ key: "b2", name: "B2", step: 2 }),
      s({ key: "b3", name: "B3", step: 3, review: KT, back: [1] }),
    ],
  },
  auto3: {
    id: PB2.auto3,
    key: "pb2-auto3",
    name: "Ba song song",
    stages: [
      s({ key: "x", name: "X", step: 0 }),
      s({ key: "y1", name: "Y1", step: 1, agent: P1.agM1 }),
      s({ key: "y2", name: "Y2", step: 1, agent: P1.agM2 }),
      s({ key: "y3", name: "Y3", step: 1, agent: P1.agM3 }),
      s({ key: "z", name: "Z", step: 2 }),
    ],
  },
  real: {
    id: PB2.real,
    key: "pb2-real",
    name: "Ghi sổ hai người",
    stages: [
      s({ key: "r0a", name: "R0a", step: 0, review: KT }),
      s({ key: "r0b", name: "R0b", step: 0, agent: P1.agM1, review: PB2.gTest }),
      s({ key: "ghi", name: "Ghi sổ", step: 1, agent: P1.agPost, real: true }),
    ],
  },
  team0: {
    id: PB2.team0,
    key: "pb2-team0",
    name: "Nhóm bước đầu",
    stages: [
      s({ key: "nhom", name: "Nhóm đọc", step: 0, team: P1.teamPm, sections: TEAM_SEC }),
      s({ key: "ket", name: "Kết", step: 1 }),
    ],
  },
  team0p: {
    id: PB2.team0p,
    key: "pb2-team0p",
    name: "Nhóm song song",
    stages: [
      s({ key: "nhom", name: "Nhóm đọc", step: 0, team: P1.teamPm, sections: TEAM_SEC }),
      s({ key: "doc", name: "Đọc đơn", step: 0 }),
      s({ key: "ket", name: "Kết", step: 1, agent: P1.agPost }),
    ],
  },
  same: {
    id: PB2.same,
    key: "pb2-same",
    name: "Cùng agent",
    stages: [
      s({ key: "s0", name: "S0", step: 0, agent: P1.agPost, review: KT }),
      s({ key: "s1a", name: "S1a", step: 1, agent: P1.agM1, review: KT }),
      s({ key: "s1b", name: "S1b", step: 1, agent: P1.agM1, review: KT }),
    ],
  },
  par2: {
    id: PB2.par2,
    key: "pb2-par2",
    name: "Cùng đích",
    stages: [
      s({ key: "p0", name: "P0", step: 0, review: KT }),
      s({ key: "p1a", name: "P1a", step: 1, agent: P1.agM1, review: KT, back: [0] }),
      s({ key: "p1b", name: "P1b", step: 1, agent: P1.agM2, review: PB2.gTest, back: [0] }),
    ],
  },
  par3: {
    id: PB2.par3,
    key: "pb2-par3",
    name: "Khác đích",
    stages: [
      s({ key: "q0", name: "Q0", step: 0 }),
      s({ key: "q1", name: "Q1", step: 1 }),
      s({ key: "q2a", name: "Q2a", step: 2, agent: P1.agM1, review: KT, back: [0] }),
      s({ key: "q2b", name: "Q2b", step: 2, agent: P1.agM2, review: PB2.gTest, back: [1] }),
    ],
  },
  seqSame: {
    id: PB2.seqSame,
    key: "pb2-seq-same",
    name: "Tuần tự cùng agent",
    stages: [
      s({ key: "a1", name: "A1", agent: P1.agPost }),
      s({ key: "a2", name: "A2", agent: P1.agPost }),
    ],
  },
} as const;
export type Def2 = (typeof DEFS2)[keyof typeof DEFS2];

/** 0024 có chưa: cột `process_runs.current_step` + bảng `process_back_events`. */
export async function hasPb2Schema(sql: Sql): Promise<boolean> {
  const [r] = await sql<{ ok: boolean }[]>`select
      to_regclass('hub.process_back_events') is not null
      and exists (select 1 from information_schema.columns
                  where table_schema = 'hub' and table_name = 'process_runs' and column_name = 'current_step') as ok`;
  return r?.ok === true;
}
/** Đầu mỗi ca int: đỏ đúng lý do khi chưa có migration 0024. */
export function needPb2(ready: boolean): void {
  expect({ migration0024: ready }).toEqual({ migration0024: true });
}

/** Group "Kiểm thử" (T) + grant A cho m1–m3 + def P-b2. */
export async function seedPb2(sql: Sql): Promise<void> {
  await sql`insert into admin.groups (id, tenant_id, key, name)
    values (${PB2.gTest}, ${T.acme}, 'kiem-thu', ${sql.json({ vi: "Kiểm thử", en: "Testing" })})`;
  await sql`insert into admin.group_members (tenant_id, group_id, user_id) values (${T.acme}, ${PB2.gTest}, ${PA.T.id})`;
  await sql`insert into hub.agent_grants ${sql(
    [P1.agM1, P1.agM2, P1.agM3].map((agent_id) => ({
      agent_id,
      tenant_id: T.acme,
      subject_type: "user",
      subject_id: PA.A.id,
    })),
  )}`;
  await sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
  for (const d of Object.values(DEFS2)) await insertDefPf1(sql, d as Json);
}

export type CtxPb2 = CtxPf1 & { pb2: boolean };
/** DB sạch + seed P-a/PF1 + seed P-b2 + hub-api launcher thật. `pb2` = 0024 có. Quota mặc định 50 run/tenant (ca không
 * kiểm quota không phụ thuộc thứ tự); PI-13 truyền 1. */
export async function startPb2(o: Pf1Opts = {}): Promise<CtxPb2> {
  const c = await startPf1({ processRunsPerTenant: 50, ...o });
  const pb2 = c.ready && (await hasPb2Schema(c.sql));
  if (c.ready) await seedPb2(c.sql);
  return { ...c, pb2 };
}

// ---------- job theo stage (song song: nhiều job queued cùng lúc) ----------
/** Job `queued` của stage `idx` (chờ tới `ms`) rồi claim. Hub chưa tạo ⇒ đỏ ở expect. */
export async function jobOfStage(c: CtxPf1, runId: string, idx: number, ms = 8_000): Promise<Job> {
  const row = await waitFor(
    async () =>
      (
        await c.sql<{ run_id: string }[]>`select j.run_id from hub.jobs j
          join hub.runs r on r.id = j.run_id join hub.stage_runs sr on sr.id = r.stage_run_id
          where r.process_run_id = ${runId} and sr.stage_idx = ${idx} and j.status = 'queued'
          order by j.created_at limit 1`
      )[0],
    (v) => v !== undefined,
    ms,
  );
  expect({ stage: idx, queuedJob: row !== undefined }).toEqual({ stage: idx, queuedJob: true });
  return c.rt.next((row as { run_id: string }).run_id);
}
/** stage_idx của mọi job `queued` hiện có (tăng dần). */
export async function queuedStages(sql: Sql, runId: string): Promise<number[]> {
  const rows = await sql<{ i: number }[]>`select sr.stage_idx::int as i from hub.jobs j
    join hub.runs r on r.id = j.run_id join hub.stage_runs sr on sr.id = r.stage_run_id
    where r.process_run_id = ${runId} and j.status = 'queued' order by sr.stage_idx`;
  return rows.map((r) => r.i);
}
/** Chờ tới khi có ít nhất `n` job queued ⇒ trả danh sách stage. */
export async function waitQueued(
  sql: Sql,
  runId: string,
  n: number,
  ms = 8_000,
): Promise<number[]> {
  return (
    (await waitFor(
      () => queuedStages(sql, runId),
      (v) => v.length >= n,
      ms,
    )) ?? []
  );
}
/** `hub.runs` của một stage (theo thời gian). */
export const hubRunsOf = (sql: Sql, runId: string, idx: number) =>
  sql<
    Json[]
  >`select r.id, r.status, r.user_id from hub.runs r join hub.stage_runs sr on sr.id = r.stage_run_id
    where r.process_run_id = ${runId} and sr.stage_idx = ${idx} and r.team_run_id is null order by r.started_at, r.id`;
/** Task `kind` của stage `idx` (mới nhất; `status` lọc nếu có). */
export async function taskOf(
  sql: Sql,
  runId: string,
  idx: number,
  kind = "review",
  status: string | null = "open",
): Promise<Json | undefined> {
  const rows = await sql<
    Json[]
  >`select t.* from hub.review_tasks t join hub.stage_runs sr on sr.id = t.stage_run_id
    where t.process_run_id = ${runId} and sr.stage_idx = ${idx} and t.kind = ${kind}
    order by t.created_at desc`;
  return rows.find((t) => status === null || t.status === status);
}
/** Chờ stage `idx` về `status`. */
export async function waitStage(
  sql: Sql,
  runId: string,
  idx: number,
  status: string,
  ms = 8_000,
): Promise<Json> {
  const r = await waitFor(
    () => stageRow(sql, runId, idx),
    (v) => v?.status === status,
    ms,
  );
  expect({ stage: idx, status: r?.status }).toEqual({ stage: idx, status });
  return r;
}
/** Chạy xong các stage `idxs` (mỗi stage 1 job) với `md`. */
export async function finishStages(
  c: CtxPf1,
  runId: string,
  idxs: number[],
  md = MD_HO,
): Promise<Job[]> {
  const jobs: Job[] = [];
  for (const i of idxs) {
    const j = await jobOfStage(c, runId, i);
    await jobDone(c, j, md);
    jobs.push(j);
  }
  return jobs;
}
/** Người `who` chấm Đạt task review mở của stage `idx`. */
export async function passStage(c: CtxPf1, runId: string, idx: number, who: Role): Promise<void> {
  await waitStage(c.sql, runId, idx, "waiting_review");
  const t = await taskOf(c.sql, runId, idx);
  expect((await review(c, who, t?.id, { result: "pass" })).status).toBe(200);
}

/**
 * `pb2-par` tới bước 1: stage 0 xong + B Đạt ⇒ stage 1, 2 chạy. `both=true` ⇒ cả hai trả `md` và về `waiting_review`.
 */
export async function parToStep1(
  c: CtxPf1,
  o: { both?: boolean; md?: string } = {},
): Promise<{ runId: string; flowId: string }> {
  const s = await startInRoom(c, { key: DEFS2.par.key });
  await finishStages(c, s.runId, [0], o.md);
  await passStage(c, s.runId, 0, "B");
  if (o.both) {
    await finishStages(c, s.runId, [1, 2], o.md);
    await waitStage(c.sql, s.runId, 1, "waiting_review");
    await waitStage(c.sql, s.runId, 2, "waiting_review");
  }
  return { runId: s.runId, flowId: s.flowId };
}

/**
 * `pb2-back` tới B3 `waiting_review` (B0 auto → B1 Đạt bởi B → B2 auto → B3). `md(idx)` = nội dung output từng stage.
 * Trả `taskId` = task review mở của B3.
 */
export async function backToB3(
  c: CtxPf1,
  md: (idx: number) => string = () => MD_HO,
): Promise<{ runId: string; flowId: string; taskId: string }> {
  const s = await startInRoom(c, { key: DEFS2.back.key });
  await finishStages(c, s.runId, [0], md(0));
  await finishStages(c, s.runId, [1], md(1));
  await passStage(c, s.runId, 1, "B");
  await finishStages(c, s.runId, [2], md(2));
  await finishStages(c, s.runId, [3], md(3));
  await waitStage(c.sql, s.runId, 3, "waiting_review");
  const t = await taskOf(c.sql, s.runId, 3);
  return { runId: s.runId, flowId: s.flowId, taskId: t?.id };
}

/** Prompt (payload) của job. */
export const promptOf = (j: Job): string => String(j.payload.prompt ?? "");
/** Tên file đính kèm của job. */
export const attachNames = (j: Job): string[] =>
  ((j.payload.attachments ?? []) as Json[]).map((a) => String(a.name ?? ""));
/** Đếm `process_back_events` của run. */
export const backEvents = (sql: Sql, runId: string) =>
  sql<
    Json[]
  >`select * from hub.process_back_events where process_run_id = ${runId} order by created_at, id`;
/** Lấy view (`GET /process-runs/:id`) bởi persona. */
export const viewOf = (c: CtxPf1, who: Role, runId: string) =>
  c.call(who, "GET", `/process-runs/${runId}`);
/** Bỏ mọi run đang sống (giữa các ca; tránh quota). */
export async function settleRuns(sql: Sql): Promise<void> {
  await sql`update hub.jobs set status = 'succeeded', finished_at = now() where status in ('queued', 'running')`;
  await sql`update hub.runs set status = 'cancelled', error_code = 'CANCELLED', error_message = 'qc settle',
      error_hint = 'qc settle', finished_at = now(), owner = null, lease_until = null
    where status in ('running', 'waiting')`;
  await sql`update hub.process_runs set status = 'cancelled', finished_at = now()
    where status not in ('done', 'cancelled', 'failed', 'expired')`;
  await sql`update hub.review_tasks set status = 'closed', result = 'cancelled', decided_at = now() where status = 'open'`;
}
/** Đợi run có trạng thái (dùng lại `waitStatus`) rồi đọc lại hàng. */
export async function runNow(sql: Sql, runId: string): Promise<Json> {
  return runRow(sql, runId);
}
