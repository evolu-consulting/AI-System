// HUB-BR-25 · AC-H29 · HUB-FR-113 · ma trận cách ly PF1 (test-plan-int §6, plan-contract §8): 11 vai × 9 cột PF1
// {GET run, output đang kiểm, output khác, decision, decide, cancel, `GET /rooms/R`+tin R (gồm `?flow_id=F`), hội thoại nền
// (C1), `/runs/:stage` (H1)} = 99 ô, mỗi ô một `it` `M-<vai>-<cột>` + 2 ô chú thích ² (decide `redo_limit`). Cột usage ⇒ pf4,
// answer/forward ⇒ pf2. Run R1 (SQL) do A bắt đầu ở R, `waiting_review` stage 0, task review gán Group Kế toán + T (forward của
// B), task ask đã đóng (H). A' = người bắt đầu đã rời phòng: run R1' ở phòng R3 (A owner rồi rời, U5). Ô "Đ" có ghi (decision,
// cancel) chạy trên run mới dựng cùng dạng để không đổi R1. Cột H1 dùng `GET /runs/:id` (cùng kiểm quyền với `/events`, tránh
// giữ SSE). Adm/P cột phòng = "theo X2a" ⇒ so với người ngoài phòng cùng tenant (q06).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { sign } from "../../H1/_fixtures";
import { api, Q } from "../../X2a/_x2a";
import {
  fixId,
  insertOutput,
  insertRun,
  insertTask,
  type Json,
  PA,
  PA_FIX,
  postRoom,
  type Res,
  type RunFix,
  type Sql,
  T,
} from "../_support/pa";
import { needSchema } from "../_support/schema";
import { type CtxPf1, DEFS, startPf1 } from "./_local";

const TO = 30_000;
let c: CtxPf1;
const ROOM3 = "a5a18000-0000-4000-8000-000000000003"; // phòng của A' (A owner đã rời), B member

type Fx = RunFix & { roomId: string; oCur: string; oOld: string; taskId: string; hubRunId: string };
let R1: Fx;
let R1L: Fx; // R1' cho A'

/** `hub.runs` của stage (cột 0019 `process_run_id`/`stage_run_id`), kèm tin hội thoại nền như H1. */
async function insertStageHubRun(
  sql: Sql,
  f: RunFix,
  starter: { id: string; tid: string },
): Promise<string> {
  const id = fixId();
  const mu = fixId();
  const ma = fixId();
  await sql`insert into hub.messages (id, tenant_id, user_id, conversation_id, flow_id, role, content, run_id) values
    (${mu}, ${starter.tid}, ${starter.id}, ${f.convId}, ${f.flowId}, 'user', 'Stage 1', null),
    (${ma}, ${starter.tid}, ${starter.id}, ${f.convId}, ${f.flowId}, 'assistant', 'Xong', ${id})`;
  await sql`insert into hub.runs (id, tenant_id, user_id, conversation_id, flow_id, status, config_version,
      user_message_id, answer_message_id, last_seq, finished_at, process_run_id, stage_run_id)
    values (${id}, ${starter.tid}, ${starter.id}, ${f.convId}, ${f.flowId}, 'finished', 1, ${mu}, ${ma}, 2, now(),
      ${f.runId}, ${f.stageRunIds[0] as string})`;
  return id;
}

/** Run `hoa-don-t` ở `roomId`: v1 cũ + v2 đang kiểm, task review (Group Kế toán + T qua forward của B), ask đóng (H). */
async function mkRun(sql: Sql, roomId: string, o: { decision?: boolean } = {}): Promise<Fx> {
  const f = await insertRun(sql, {
    def: DEFS.hd as never,
    startedBy: PA.A,
    roomId,
    status: o.decision ? "needs_decision" : "waiting_review",
    decision: o.decision
      ? {
          reason: "redo_limit",
          stage_idx: 0,
          options: ["add_attempt", "use_current", "cancel"],
          at: new Date().toISOString(),
        }
      : null,
  });
  const base = { tid: T.acme, runId: f.runId, stageRunId: f.stageRunIds[0] as string, stageIdx: 0 };
  const oOld = await insertOutput(sql, { ...base, version: 1 });
  const oCur = await insertOutput(sql, { ...base, version: 2 });
  await sql`update hub.stage_runs set current_output_id = ${oCur}, attempt = 2 where id = ${base.stageRunId}`;
  let taskId: string;
  if (o.decision) {
    taskId = await insertTask(sql, {
      ...base,
      kind: "decision",
      reason: "redo_limit",
      groupId: PA_FIX.gKeToan,
      userIds: [PA.A.id],
    });
  } else {
    taskId = await insertTask(sql, {
      ...base,
      kind: "review",
      outputId: oCur,
      groupId: PA_FIX.gKeToan,
      userIds: [PA.T.id],
    });
    await sql`update hub.review_task_assignees set via = 'forward', from_user_id = ${PA.B.id}, depth = 1
      where task_id = ${taskId} and user_id = ${PA.T.id}`;
  }
  await insertTask(sql, { ...base, kind: "ask", userIds: [PA.H.id], status: "closed" });
  const hubRunId = await insertStageHubRun(sql, f, PA.A);
  return { ...f, roomId, oCur, oOld, taskId, hubRunId };
}

beforeAll(async () => {
  c = await startPf1();
  if (!c.ready) return;
  await c.sql`insert into hub.rooms (id, tenant_id, kind, name, last_seq, last_activity_at, created_by, created_at)
    values (${ROOM3}, ${T.acme}, 'group', 'Phòng R3', 0, now(), ${PA.A.id}, now())`;
  await c.sql`insert into hub.room_members (room_id, tenant_id, user_id, role, joined_at, last_read_seq, left_at) values
    (${ROOM3}, ${T.acme}, ${PA.A.id}, 'owner', now() - interval '2 day', 0, now() - interval '1 hour'),
    (${ROOM3}, ${T.acme}, ${PA.B.id}, 'member', now() - interval '2 day', 0, null)`;
  R1 = await mkRun(c.sql, PA_FIX.room);
  R1L = await mkRun(c.sql, ROOM3);
  await postRoom(c, "A", PA_FIX.room, { content: "ROOM-SECRET-P1 số liệu nội bộ" });
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

// ---------- vai ----------
type Vai = "A" | "X" | "A'" | "L" | "B" | "T" | "H" | "q06" | "D" | "Adm" | "P";
const Q06 = Q[5] as Json;
/** Gọi API theo vai; D, P thêm `?tenant_id=acme`. */
async function as(v: Vai, method: string, path: string, body?: unknown): Promise<Res> {
  const tq = (p: string) => `${p}${p.includes("?") ? "&" : "?"}tenant_id=${T.acme}`;
  if (v === "q06") return api(c.hub, await sign(c.k, Q06), method, path, body);
  if (v === "D" || v === "P") return c.call(v, method, tq(path), body);
  return c.call(v === "A'" ? "A" : v, method, path, body);
}
const runOf = (v: Vai): Fx => (v === "A'" ? R1L : R1);

// ---------- cột ----------
type Col =
  | "run"
  | "outCur"
  | "outOther"
  | "decision"
  | "decide"
  | "cancel"
  | "room"
  | "conv"
  | "runs";
type Exp = "full" | "task" | "taskAsk" | "taskLeft" | "D" | "4" | "3" | "409" | "X2a";
const COLS: Col[] = [
  "run",
  "outCur",
  "outOther",
  "decision",
  "decide",
  "cancel",
  "room",
  "conv",
  "runs",
];
const ALL4: Exp[] = ["4", "4", "4", "4", "4", "4", "4", "4", "4"];
const M: Record<Vai, Exp[]> = {
  A: ["full", "D", "D", "4", "409", "D", "D", "4", "D"],
  X: ["full", "D", "D", "4", "3", "3", "D", "4", "4"],
  "A'": ["taskLeft", "D", "D", "4", "409", "D", "4", "4", "D"],
  L: ALL4,
  B: ["full", "D", "D", "D", "3", "3", "D", "4", "4"],
  T: ["task", "D", "4", "D", "3", "3", "4", "4", "4"],
  H: ["taskAsk", "4", "4", "4", "3", "3", "4", "4", "4"],
  q06: ALL4,
  D: ALL4,
  Adm: ["full", "D", "D", "4", "409", "D", "X2a", "4", "4"],
  P: ["full", "D", "D", "4", "409", "D", "X2a", "4", "4"],
};
const code = (r: Res) => r.json?.error?.code;

async function roomStatuses(v: Vai, f: Fx): Promise<number[]> {
  const a = await as(v, "GET", `/rooms/${f.roomId}`);
  const b = await as(v, "GET", `/rooms/${f.roomId}/messages?flow_id=${f.flowId}`);
  const m = await as(v, "GET", `/rooms/${f.roomId}/messages`);
  return [a.status, b.status, m.status];
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: một bảng kỳ vọng theo cột (dễ đối chiếu §6)
async function cell(v: Vai, col: Col, e: Exp): Promise<void> {
  const f = runOf(v);
  const run = `/process-runs/${f.runId}`;
  switch (col) {
    case "run": {
      const r = await as(v, "GET", run);
      if (e === "4") {
        expect(r.status).toBe(404);
        return;
      }
      expect(r.status).toBe(200);
      expect(r.json?.access).toBe(e === "full" ? "full" : "task");
      if (e === "taskAsk") expect((r.json?.my_tasks as Json[])?.[0]?.kind).toBe("ask");
      if (e === "task")
        expect((r.json?.my_tasks as Json[])?.some((t) => t.id === f.taskId)).toBe(true);
      if (e === "taskLeft") {
        expect(r.json?.my_tasks).toEqual([]);
        expect((r.json?.outputs as Json[])?.length ?? 0).toBeGreaterThanOrEqual(1);
        expect(r.json?.can_cancel).toBe(true);
        expect(r.json?.thread).toBeUndefined();
        expect(r.json?.history).toBeUndefined();
      }
      return;
    }
    case "outCur":
    case "outOther": {
      const oid = col === "outCur" ? f.oCur : f.oOld;
      const r = await as(v, "GET", `${run}/outputs/${oid}`);
      expect(r.status).toBe(e === "D" ? 200 : 404);
      if (e === "D") expect(r.json?.id).toBe(oid);
      return;
    }
    case "decision": {
      const g = e === "D" ? await mkRun(c.sql, f.roomId) : f;
      const r = await as(v, "POST", `/review-tasks/${g.taskId}/decision`, { result: "pass" });
      expect(r.status).toBe(e === "D" ? 200 : 404);
      return;
    }
    case "decide": {
      const r = await as(v, "POST", `${run}/decide`, { option: "add_attempt" });
      const want = {
        "409": [409, "PROCESS_RUN_STATE"],
        "3": [403, "NOT_PROCESS_DECIDER"],
        "4": [404, undefined],
      }[e as "409" | "3" | "4"];
      expect(r.status).toBe(want?.[0] as number);
      if (want?.[1]) expect(code(r)).toBe(want[1] as string);
      return;
    }
    case "cancel": {
      const g = e === "D" ? await mkRun(c.sql, f.roomId) : f;
      const r = await as(v, "POST", `/process-runs/${g.runId}/cancel`, {});
      if (e === "D") {
        expect(r.status).toBe(200);
        expect(r.json?.status).toBe("cancelled");
      } else if (e === "3") {
        expect(r.status).toBe(403);
        expect(code(r)).toBe("NOT_PROCESS_DECIDER");
      } else expect(r.status).toBe(404);
      return;
    }
    case "room": {
      const s = await roomStatuses(v, f);
      if (e === "X2a") expect(s).toEqual(await roomStatuses("q06", f));
      else expect(s).toEqual(e === "D" ? [200, 200, 200] : [404, 404, 404]);
      return;
    }
    case "conv": {
      expect((await as(v, "GET", `/conversations/${f.convId}`)).status).toBe(404);
      return;
    }
    case "runs": {
      expect((await as(v, "GET", `/runs/${f.hubRunId}`)).status).toBe(e === "D" ? 200 : 404);
      return;
    }
  }
}

describe("Ma trận cách ly PF1 [HUB-BR-25, AC-H29]", () => {
  for (const v of Object.keys(M) as Vai[])
    for (const [i, col] of COLS.entries()) {
      const e = M[v][i] as Exp;
      it(
        `HUB-BR-25 · M-${v}-${col} · ${v} × ${col} ⇒ ${e}`,
        async () => {
          needSchema(c.ready);
          await cell(v, col, e);
        },
        TO,
      );
    }

  for (const v of ["B", "T"] as Vai[])
    it(
      `HUB-BR-25 · M-${v}-decide-redo · ² ${v} (Group duyệt) decide khi needs_decision redo_limit ⇒ 200 (Q2)`,
      async () => {
        needSchema(c.ready);
        const g = await mkRun(c.sql, PA_FIX.room, { decision: true });
        const r = await as(v, "POST", `/process-runs/${g.runId}/decide`, { option: "add_attempt" });
        expect(r.status).toBe(200);
      },
      TO,
    );
});
