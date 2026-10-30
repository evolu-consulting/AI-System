/// <reference lib="dom" />
// HUB-FR-104…118 · ADM-FR-71 · CHAT-AC-59/60 · e2e P-b2 · helper Playwright (test-plan §4; nhãn nguyên văn plan-frontend §7 +
// plan-frontend-i18n): dùng lại helper P-a (persona, Runtime giả, `settle`, `adminLogin`) + `seedPb2Run` dựng run ở trạng thái
// (a) (a') (b) (c) (d) bằng SQL owner. Cột/bảng 0024 vắng ⇒ `seedPb2Run` KHÔNG chèn, trả `ready:false` ⇒ ca đỏ ở locator/expect
// UI (không đỏ ở dựng dữ liệu).
import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import type postgres from "postgres";
import { fullMd } from "../P-a/_pa-data";
import { adminLogin, hub, tok, withSql } from "../P-a/_pa-support";
import { ACME, DEF_PAR, DEF_PAR2, PA_E2E, PB2_E2E, PERSONA } from "./_pb2-data";

export {
  adminLogin,
  block,
  failBtn,
  hub,
  mkRoom,
  passBtn,
  rtScript,
  seedRun,
  settle,
  tok,
  users,
  withSql,
} from "../P-a/_pa-support";
export { DEF_CANVAS, DEF_FULL, DEF_PAR, DEF_PAR2, PB2_E2E, PERSONA } from "./_pb2-data";

// biome-ignore lint/suspicious/noExplicitAny: json theo contract chưa có
type Json = any;
type Who = keyof typeof PERSONA;

/** 0024 có chưa (cột `process_runs.current_step` + bảng `process_back_events`). */
export const pb2Ready = () =>
  withSql(async (sql) => {
    const [r] = await sql<
      { ok: boolean }[]
    >`select to_regclass('hub.process_back_events') is not null
      and exists (select 1 from information_schema.columns where table_schema = 'hub'
        and table_name = 'process_runs' and column_name = 'current_step') as ok`;
    return r?.ok === true;
  });

export type SeedKind = "a" | "a2" | "b" | "c" | "d";
export type Pb2Run = {
  ready: boolean;
  runId: string;
  flowId: string;
  stageRunIds: string[];
  /** task mở theo stage_idx. */
  tasks: Record<number, string>;
};
type StagePlan = {
  status: string;
  round: number;
  outs: number[];
  task?: string;
  backTo?: number;
  fb?: string;
};

/** Kế hoạch từng seed (test-plan §4). `outs` = danh sách `round` của các version output (v1, v2…). */
function planOf(kind: SeedKind): {
  def: typeof DEF_PAR | typeof DEF_PAR2;
  status: string;
  step: number;
  rounds: number;
  stages: StagePlan[];
  events: { from: number; fromStep: number; to: number; round: number; by: Who; fb: string }[];
} {
  const KT = PA_E2E.gKeToan;
  const step1 = (r = 1): StagePlan[] => [
    { status: "done", round: 1, outs: [1] },
    { status: "waiting_review", round: r, outs: [1], task: KT },
    { status: "waiting_review", round: r, outs: [1], task: KT },
    { status: "pending", round: 1, outs: [] },
  ];
  if (kind === "a")
    return {
      def: DEF_PAR,
      status: "waiting_review",
      step: 1,
      rounds: 0,
      stages: step1(),
      events: [],
    };
  if (kind === "d")
    return {
      def: DEF_PAR,
      status: "waiting_review",
      step: 1,
      rounds: 3,
      stages: step1(),
      events: [],
    };
  if (kind === "a2")
    return {
      def: DEF_PAR2,
      status: "waiting_review",
      step: 1,
      rounds: 0,
      stages: [
        { status: "done", round: 1, outs: [1] },
        { status: "waiting_review", round: 1, outs: [1], task: KT },
        { status: "waiting_review", round: 1, outs: [1], task: PB2_E2E.gTest },
      ],
      events: [],
    };
  if (kind === "b")
    return {
      def: DEF_PAR,
      status: "waiting_review",
      step: 0,
      rounds: 2,
      stages: [
        { status: "waiting_review", round: 2, outs: [1, 2], task: KT },
        { status: "pending", round: 3, outs: [1, 2] },
        { status: "pending", round: 3, outs: [1, 2] },
        { status: "pending", round: 2, outs: [1] },
      ],
      events: [
        { from: 3, fromStep: 2, to: 1, round: 2, by: "B", fb: "Thiếu số liệu tổng hợp" },
        { from: 2, fromStep: 1, to: 0, round: 3, by: "B", fb: "Thiếu ca hồi quy" },
      ],
    };
  return {
    def: DEF_PAR,
    status: "needs_decision",
    step: 2,
    rounds: 3,
    stages: [
      { status: "done", round: 1, outs: [1] },
      { status: "done", round: 1, outs: [1] },
      { status: "done", round: 1, outs: [1] },
      { status: "needs_decision", round: 1, outs: [1], backTo: 1, fb: "Vẫn thiếu số liệu" },
    ],
    events: [],
  };
}

async function insertRunRows(
  sql: postgres.Sql,
  roomId: string | null,
  kind: SeedKind,
): Promise<Pb2Run> {
  const p = planOf(kind);
  const d = p.def;
  const A = PERSONA.A;
  const runId = randomUUID();
  const flowId = randomUUID();
  const convId = randomUUID();
  const now = Date.now();
  await sql`insert into hub.conversations (id, tenant_id, user_id, title, title_norm, process_run_id)
    values (${convId}, ${ACME}, ${A.id}, ${d.name}, ${d.name.toLowerCase()}, ${runId})`;
  await sql`insert into hub.flows (id, tenant_id, user_id, conversation_id, title, message_count)
    values (${flowId}, ${ACME}, ${A.id}, ${convId}, ${d.name}, 0)`;
  const firstIdx = d.stages.findIndex((s: Json) => s.step === p.step);
  await sql`insert into hub.process_runs ${sql({
    id: runId,
    tenant_id: ACME,
    process_def_id: d.id,
    def_version: 1,
    snapshot: sql.json({
      key: d.key,
      name: d.name,
      stages: d.stages as Json,
      token_budget: null,
      run_group_ids: [],
    }),
    started_by: A.id,
    origin_kind: roomId ? "room" : "admin",
    origin_room_id: roomId,
    input: "HD-12 tháng 9",
    conversation_id: convId,
    flow_id: flowId,
    status: p.status,
    current_stage_idx: firstIdx,
    current_step: p.step,
    back_rounds: p.rounds,
    back_limit: 3,
    decision:
      kind === "c"
        ? sql.json({
            reason: "back_limit",
            stage_idx: 3,
            options: ["add_attempt", "use_current", "cancel"],
            at: new Date(now).toISOString(),
            back_to_step: 1,
          })
        : null,
    expires_at: new Date(now + 7 * 86_400_000),
    started_at: new Date(now - 3_600_000),
    updated_at: new Date(now),
  })}`;
  const stageRunIds: string[] = [];
  const tasks: Record<number, string> = {};
  for (const [i, s] of p.stages.entries()) {
    const id = randomUUID();
    stageRunIds.push(id);
    await sql`insert into hub.stage_runs (id, tenant_id, process_run_id, stage_idx, status, round, back_to_step, feedback)
      values (${id}, ${ACME}, ${runId}, ${i}, ${s.status}, ${s.round}, ${s.backTo ?? null}, ${s.fb ?? null})`;
    let last: string | null = null;
    for (const [k, round] of s.outs.entries()) {
      last = randomUUID();
      await sql`insert into hub.process_outputs (id, tenant_id, process_run_id, stage_run_id, stage_idx, version, attempt,
          content, template_ok, round, created_at)
        values (${last}, ${ACME}, ${runId}, ${id}, ${i}, ${k + 1}, 1,
          ${fullMd(["Bảng ý", "Số tiền", "Bàn giao"], `v${k + 1}`)}, true, ${round}, ${new Date(now - 60_000 + k * 1_000)})`;
    }
    if (last) await sql`update hub.stage_runs set current_output_id = ${last} where id = ${id}`;
    if (s.task) tasks[i] = await insertTask(sql, runId, id, "review", last, s.task, []);
    if (s.status === "needs_decision")
      tasks[i] = await insertTask(sql, runId, id, "decision", null, PA_E2E.gKeToan, ["A"]);
  }
  for (const [k, e] of p.events.entries())
    await sql`insert into hub.process_back_events ${sql({
      tenant_id: ACME,
      process_run_id: runId,
      task_id: null,
      from_stage_idx: e.from,
      from_step: e.fromStep,
      to_step: e.to,
      round_after: e.round,
      feedback: e.fb,
      decided_by: PERSONA[e.by].id,
      created_at: new Date(now - 30_000 + k * 1_000),
    })}`;
  if (roomId)
    await sql`insert into hub.process_thread_events (id, tenant_id, process_run_id, room_id, kind, placement, meta, content,
        created_at)
      values (${randomUUID()}, ${ACME}, ${runId}, ${roomId}, 'block', 'main',
        ${sql.json({ kind: "block", process_run_id: runId, process: { key: d.key, name: d.name }, stage_count: d.stages.length })},
        ${`${d.name} · block`}, now())`;
  return { ready: true, runId, flowId, stageRunIds, tasks };
}

async function insertTask(
  sql: postgres.Sql,
  runId: string,
  stageRunId: string,
  kind: "review" | "decision",
  outputId: string | null,
  groupId: string,
  users: Who[],
): Promise<string> {
  const id = randomUUID();
  await sql`insert into hub.review_tasks ${sql({
    id,
    tenant_id: ACME,
    process_run_id: runId,
    stage_run_id: stageRunId,
    kind,
    status: "open",
    output_id: outputId,
    reason: kind === "decision" ? "back_limit" : null,
    assignee_group_id: groupId,
    remind_at: new Date(Date.now() + 86_400_000),
  })}`;
  await sql`insert into hub.review_task_assignees ${sql({ tenant_id: ACME, task_id: id, group_id: groupId, via: "initial", depth: 0 })}`;
  for (const w of users)
    await sql`insert into hub.review_task_assignees ${sql({
      tenant_id: ACME,
      task_id: id,
      user_id: PERSONA[w].id,
      via: "initial",
      depth: 0,
    })}`;
  return id;
}

/** Dựng run P-b2 (test-plan §4 seed a/a'/b/c/d) ở phòng `roomId`. 0024 vắng ⇒ `ready:false`, không chèn. */
export async function seedPb2Run(roomId: string | null, kind: SeedKind): Promise<Pb2Run> {
  if (!(await pb2Ready()))
    return { ready: false, runId: randomUUID(), flowId: randomUUID(), stageRunIds: [], tasks: {} };
  return withSql((sql) => insertRunRows(sql, roomId, kind));
}
/** Thêm `who` làm assignee (user) của task (ca ngoài phòng). */
export const addAssignee = (taskId: string, who: Who) =>
  withSql(
    (sql) =>
      sql`insert into hub.review_task_assignees ${sql({ tenant_id: ACME, task_id: taskId, user_id: PERSONA[who].id, via: "initial", depth: 0 })}`,
  );
/** View run qua Hub (persona `who`). */
export async function runView(who: Who, runId: string): Promise<Json> {
  return (await hub(await tok(who), "GET", `/process-runs/${runId}`)).json;
}

// ---------- admin canvas ----------
/** Mở def `key` ("tên") ở admin-web (bảng "Quy trình"). */
export async function openDef(p: Page, key: string, name: string): Promise<void> {
  await adminLogin(p);
  await p
    .getByRole("navigation", { name: "Điều hướng chính" })
    .getByRole("link", { name: "Quy trình", exact: true })
    .click();
  await p
    .getByRole("table", { name: "Quy trình" })
    .getByRole("row")
    .filter({ hasText: key })
    .getByRole("link", { name })
    .click();
}
export const canvas = (p: Page) => p.getByRole("application", { name: "Canvas quy trình" });
export const panel = (p: Page) => p.getByRole("complementary", { name: "Chi tiết giai đoạn" });
/** Nút stage `Giai đoạn n: <tên>` (n có thể đổi sau sắp xếp ⇒ khớp theo tên). */
export const node = (p: Page, name: string) =>
  p.getByRole("button", { name: new RegExp(`^Giai đoạn \\d+: ${name}`) });
export const stepSpin = (p: Page) => panel(p).getByRole("spinbutton", { name: "Chạy ở bước" });
export const saveDef = async (p: Page): Promise<number> => {
  const put = p.waitForResponse(
    (r) => r.request().method() === "PUT" && /\/process-defs\//.test(r.url()),
  );
  await p.getByRole("button", { name: "Lưu", exact: true }).click();
  return (await put).status();
};
/** Def theo key (GET Hub, Adm). */
export async function defByKey(key: string): Promise<Json> {
  const t = await tok("Adm");
  const list = await hub(t, "GET", "/process-defs?kind=sample&limit=100");
  const item = ((list.json?.items ?? []) as Json[]).find((d) => d.key === key);
  expect(item, `GET /process-defs có ${key}`).toBeTruthy();
  return (await hub(t, "GET", `/process-defs/${item.id}`)).json;
}
