// HUB-BR-25 · AC-H29 · ma trận cách ly — cột PF2 `answer` + `forward` (test-plan-int §6; plan-contract §8). Mỗi ô một `it`
// `M-<vai>-<cột>`. R1 (A bắt đầu ở R, `waiting_review` stage 0): task review open gán Group Kế toán + T (B chuyển, depth 1);
// task ask stage 0 đã đóng (A → H, H đã trả lời). A' (U5) = L (q05, đã rời R) với run R1a cùng dạng do L bắt đầu. Cột answer
// nhắm task ask đã đóng (A'/A/H là assignee ⇒ 409, còn lại 404); cột forward nhắm task review open (H nhắm task ask của mình).
// Ô ¹ (A/A' chuyển task mình là assignee) dùng run phụ có ask open. q06 = user khác acme; D gọi kèm `?tenant_id=acme`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { sign } from "../../H1/_fixtures";
import { api, Q } from "../../X2a/_x2a";
import {
  type CtxPa,
  insertOutput,
  insertRun,
  insertTask,
  type Json,
  PA,
  PA_FIX,
  type Role,
  type RunFix,
  startPa,
  T,
} from "../_support/pa";
import { needSchema } from "../_support/schema";
import { addForward, askRun, defKT, seedDef } from "./_local";

const Q06 = Q[5] as (typeof Q)[number];
const Q07 = Q[6] as { id: string; tid: string };
const Q08 = Q[7] as { id: string; tid: string };
type Fx = { run: RunFix; review: string; ask: string };
let c: CtxPa;
let r1: Fx;
let r1a: Fx;

async function matrixRun(by: { id: string; tid: string }): Promise<Fx> {
  const run = await insertRun(c.sql, {
    def: defKT(),
    startedBy: by,
    roomId: PA_FIX.room,
    status: "waiting_review",
  });
  const sr = run.stageRunIds[0] as string;
  const outputId = await insertOutput(c.sql, {
    tid: T.acme,
    runId: run.runId,
    stageRunId: sr,
    stageIdx: 0,
  });
  const ask = await insertTask(c.sql, {
    tid: T.acme,
    runId: run.runId,
    stageRunId: sr,
    kind: "ask",
    userIds: [by.id],
    status: "closed",
  });
  await c.sql`insert into hub.review_task_assignees (tenant_id, task_id, user_id, via, from_user_id, depth)
    values (${T.acme}, ${ask}, ${PA.H.id}, 'forward', ${by.id}, 1)`;
  await c.sql`update hub.review_tasks set result = 'answer', answer = 'dd/mm', decided_by = ${PA.H.id}, decided_at = now()
    where id = ${ask}`;
  const review = await insertTask(c.sql, {
    tid: T.acme,
    runId: run.runId,
    stageRunId: sr,
    kind: "review",
    outputId,
    groupId: PA_FIX.gKeToan,
  });
  await addForward(c, review, PA.B, PA.T, 1);
  return { run, review, ask };
}

beforeAll(async () => {
  c = await startPa();
  if (!c.ready) return;
  await seedDef(c);
  await c.sql`insert into admin.group_members (tenant_id, group_id, user_id) values
    (${T.acme}, ${PA_FIX.gKeToan}, ${Q07.id}), (${T.acme}, ${PA_FIX.gKeToan}, ${Q08.id})`;
  r1 = await matrixRun(PA.A);
  r1a = await matrixRun(PA.L);
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

type Who = Role | "q06";
async function call(w: Who, path: string, body: Json) {
  const qs = w === "D" || w === "P" ? `?tenant_id=${T.acme}` : "";
  if (w !== "q06") return c.call(w, "POST", `${path}${qs}`, body);
  return api(c.hub, await sign(c.k, Q06), "POST", path, body);
}
const expectCell = (r: { status: number; json: Json }, want: number | "closed") => {
  if (want === "closed")
    expect([r.status, r.json?.error?.code]).toEqual([409, "REVIEW_TASK_CLOSED"]);
  else expect(r.status).toBe(want);
};

// [vai, kỳ vọng answer, kỳ vọng forward, run dùng] — A' = L trên R1a.
const ROWS: [string, Who, number | "closed", number | "closed", "r1" | "r1a"][] = [
  ["A", "A", "closed", 404, "r1"],
  ["X", "X", 404, 404, "r1"],
  ["A'", "L", "closed", 404, "r1a"],
  ["L", "L", 404, 404, "r1"],
  ["B", "B", 404, 200, "r1"],
  ["T", "T", 404, 200, "r1"],
  ["H", "H", "closed", "closed", "r1"],
  ["q06", "q06", 404, 404, "r1"],
  ["D", "D", 404, 404, "r1"],
  ["Adm", "Adm", 404, 404, "r1"],
  ["P", "P", 404, 404, "r1"],
];
const FWD_TO: Partial<Record<string, string>> = { B: Q07.id, T: Q08.id };

describe("M-* · cột answer [HUB-BR-25, PF2]", () => {
  for (const [name, who, want, , fx] of ROWS)
    it(`HUB-BR-25 · M-${name}-answer · ${name} trả lời task ask đã đóng ⇒ ${want}`, async () => {
      needSchema(c.ready);
      const f = fx === "r1" ? r1 : r1a;
      expectCell(await call(who, `/review-tasks/${f.ask}/answer`, { answer: "Tháng 9" }), want);
    });
});

describe("M-* · cột forward [HUB-BR-25, PF2]", () => {
  for (const [name, who, , want, fx] of ROWS)
    it(`HUB-BR-25 · M-${name}-forward · ${name} chuyển ${name === "H" ? "task ask (đã đóng)" : "task review"} ⇒ ${want}`, async () => {
      needSchema(c.ready);
      const f = fx === "r1" ? r1 : r1a;
      const task = name === "H" ? f.ask : f.review;
      expectCell(
        await call(who, `/review-tasks/${task}/forward`, { to_user_id: FWD_TO[name] ?? PA.H2.id }),
        want,
      );
    });
  it("HUB-BR-25 · M-A-forward¹ · A chuyển task ask open mà A là assignee (run phụ) ⇒ 200", async () => {
    needSchema(c.ready);
    const f = await askRun(c);
    expect(
      (await call("A", `/review-tasks/${f.taskId}/forward`, { to_user_id: PA.H.id })).status,
    ).toBe(200);
  });
  it("HUB-BR-25 · M-A'-forward¹ · A' (người bắt đầu đã rời R, U5) chuyển task ask open của mình ⇒ 200", async () => {
    needSchema(c.ready);
    const f = await askRun(c, { by: PA.L });
    expect(
      (await call("L", `/review-tasks/${f.taskId}/forward`, { to_user_id: PA.H.id })).status,
    ).toBe(200);
  });
});
