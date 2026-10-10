// HUB-FR-111 · AC-H30 · HUB-BR-24 · CHAT-AC-57 · P2-03…P2-09, P2-12, P2-15 (test-plan-int §3; plan §3.4 Forward; plan-contract §3).
// Fixture SQL run `waiting_answer`/`waiting_review`/`needs_decision` + stageLauncher giả. Ca "⇢PF1" (P2-03 phần H `GET` run —
// route `GET /process-runs/:id` thuộc PF1) chỉ xanh khi PF1 đã vào `main`. Đỏ trước code ở `needSchema`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type CtxPa, type Json, PA, PA_FIX, postRoom, startPa } from "../_support/pa";
import { needSchema } from "../_support/schema";
import {
  addForward,
  answer,
  askRun,
  assignees,
  audits,
  decisionRun,
  forward,
  reviewRun,
  seedDef,
  taskRow,
} from "./_local";

let c: CtxPa;
beforeAll(async () => {
  c = await startPa();
  if (!c.ready) return;
  await seedDef(c);
}, 60_000);
afterAll(async () => {
  await c?.stop();
});
const code = (r: { json: Json }) => r.json?.error?.code;

describe("P2-03 · nhờ người khác trả lời [AC-H30]", () => {
  it("AC-H30 · P2-03 · A chuyển → H kèm note ⇒ 200 forwards[0]{from A, to H, note}; assignee via=forward depth=1; audit forward", async () => {
    needSchema(c.ready);
    const f = await askRun(c);
    const r = await forward(c, "A", f.taskId, PA.H.id, "Hỏi kế toán giúp");
    expect(r.status).toBe(200);
    expect(r.json?.status).toBe("open");
    expect(r.json?.forwards?.[0]?.from?.id).toBe(PA.A.id);
    expect(r.json?.forwards?.[0]?.to?.id).toBe(PA.H.id);
    expect(r.json?.forwards?.[0]?.note).toBe("Hỏi kế toán giúp");
    const h = (await assignees(c, f.taskId)).find((a) => a.user_id === PA.H.id);
    expect(h).toMatchObject({
      via: "forward",
      depth: 1,
      from_user_id: PA.A.id,
      note: "Hỏi kế toán giúp",
    });
    expect((await audits(c, f.taskId, "forward")).map((a) => a.actor_id)).toEqual([PA.A.id]);
  });
  it("AC-H30 · P2-03 ⇢PF1 · H GET run ⇒ access=task, my_tasks[0] ask có question + forwards note + excerpt; không output/input/history", async () => {
    needSchema(c.ready);
    const f = await askRun(c);
    expect((await forward(c, "A", f.taskId, PA.H.id, "Hỏi kế toán giúp")).status).toBe(200);
    const v = await c.call("H", "GET", `/process-runs/${f.run.runId}`);
    expect(v.status).toBe(200);
    expect(v.json?.access).toBe("task");
    const t = v.json?.my_tasks?.[0];
    expect(t).toMatchObject({
      id: f.taskId,
      kind: "ask",
      question: "Kỳ kế toán nào?",
      excerpt: "HD-12 tháng 9",
      can_act: true,
    });
    expect(t?.forwards?.[0]?.note).toBe("Hỏi kế toán giúp");
    expect(t?.output).toBeUndefined();
    for (const k of ["input", "history", "outputs", "thread", "decision"])
      expect(v.json?.[k]).toBeUndefined();
  });
});

describe("P2-04, P2-05 · trả lời đầu thắng [HUB-BR-24]", () => {
  it("HUB-BR-24 · P2-04 · H trả lời rồi A trả lời ⇒ H 200; A 409 REVIEW_TASK_CLOSED; audit answer actor H", async () => {
    needSchema(c.ready);
    const f = await askRun(c);
    expect((await forward(c, "A", f.taskId, PA.H.id)).status).toBe(200);
    const h = await answer(c, "H", f.taskId, { answer: "dd/mm" });
    expect(h.status).toBe(200);
    const a = await answer(c, "A", f.taskId, { answer: "Tháng 9" });
    expect(a.status).toBe(409);
    expect(code(a)).toBe("REVIEW_TASK_CLOSED");
    expect(await taskRow(c, f.taskId)).toMatchObject({
      status: "closed",
      answer: "dd/mm",
      decided_by: PA.H.id,
    });
    expect((await audits(c, f.taskId, "answer")).map((x) => x.actor_id)).toEqual([PA.H.id]);
  });
  it("HUB-FR-111 · P2-05 · A ∥ H trả lời ×10 ⇒ mỗi vòng đúng 1×200 + 1×409; kick đúng 1 lần/run", async () => {
    needSchema(c.ready);
    for (let i = 0; i < 10; i++) {
      const f = await askRun(c);
      await addForward(c, f.taskId, PA.A, PA.H, 1);
      const k0 = c.hub.kicks.length;
      const rs = await Promise.all([
        answer(c, "A", f.taskId, { answer: `A-${i}` }),
        answer(c, "H", f.taskId, { answer: `H-${i}` }),
      ]);
      expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(rs.map((r) => code(r)).filter(Boolean)).toEqual(["REVIEW_TASK_CLOSED"]);
      expect(c.hub.kicks.slice(k0)).toEqual([f.run.runId]);
    }
  });
});

describe("P2-06, P2-07 · chuỗi chuyển + đích sai [AC-H30]", () => {
  it("AC-H30 · P2-06 · A→H→H2→H3 (depth 3) ⇒ 200 ×3; H3→H4 ⇒ 409 FORWARD_LIMIT; A (người chuyển) vẫn trả lời được", async () => {
    needSchema(c.ready);
    const f = await askRun(c);
    expect((await forward(c, "A", f.taskId, PA.H.id)).status).toBe(200);
    expect((await forward(c, "H", f.taskId, PA.H2.id)).status).toBe(200);
    expect((await forward(c, "H2", f.taskId, PA.H3.id)).status).toBe(200);
    const r4 = await forward(c, "H3", f.taskId, PA.H4.id);
    expect(r4.status).toBe(409);
    expect(code(r4)).toBe("FORWARD_LIMIT");
    expect((await assignees(c, f.taskId)).map((a) => a.depth)).toEqual([0, 1, 2, 3]);
    expect((await answer(c, "A", f.taskId)).status).toBe(200);
  });
  it("HUB-FR-111 · P2-07 · đích K (khoá) / D (beta) / chính mình / đã là assignee / uuid lạ ⇒ 422 FORWARD_TARGET_INVALID", async () => {
    needSchema(c.ready);
    const f = await askRun(c);
    expect((await forward(c, "A", f.taskId, PA.H.id)).status).toBe(200);
    for (const to of [PA.K.id, PA.D.id, PA.A.id, PA.H.id, "a5a00000-0000-4000-8000-0000000fffff"]) {
      const r = await forward(c, "A", f.taskId, to);
      expect({ to, status: r.status, code: code(r) }).toEqual({
        to,
        status: 422,
        code: "FORWARD_TARGET_INVALID",
      });
    }
    expect((await assignees(c, f.taskId)).length).toBe(2);
  });
});

describe("P2-08, P2-09 · loại task [HUB-FR-107, §3.4]", () => {
  it("HUB-FR-107 · P2-08 · B chuyển review → T (cùng Kế toán) ⇒ 200, T thành assignee; → H ⇒ 403 FORWARD_OUT_OF_GROUP", async () => {
    needSchema(c.ready);
    const f = await reviewRun(c);
    expect((await forward(c, "B", f.taskId, PA.T.id)).status).toBe(200);
    expect(
      (await assignees(c, f.taskId)).some((a) => a.user_id === PA.T.id && a.via === "forward"),
    ).toBe(true);
    const r = await forward(c, "B", f.taskId, PA.H.id);
    expect(r.status).toBe(403);
    expect(code(r)).toBe("FORWARD_OUT_OF_GROUP");
  });
  it("HUB-FR-111 · P2-09 · forward task decision ⇒ 409 TASK_KIND_MISMATCH; answer task review ⇒ 409 TASK_KIND_MISMATCH", async () => {
    needSchema(c.ready);
    const d = await decisionRun(c);
    const r1 = await forward(c, "A", d.taskId, PA.H.id);
    expect([r1.status, code(r1)]).toEqual([409, "TASK_KIND_MISMATCH"]);
    const rv = await reviewRun(c);
    const r2 = await answer(c, "B", rv.taskId);
    expect([r2.status, code(r2)]).toEqual([409, "TASK_KIND_MISMATCH"]);
    expect((await taskRow(c, rv.taskId))?.status).toBe("open");
  });
});

describe("P2-12, P2-15 · tin phòng không thành chuyển + validate [CHAT-AC-57, contract]", () => {
  it("CHAT-AC-57 · P2-12 · A gửi tin thread F 'Nhờ @cuc trả lời giúp' ⇒ 201 tin thường; 0 assignee mới, task không đổi", async () => {
    needSchema(c.ready);
    const f = await askRun(c);
    const before = await assignees(c, f.taskId);
    const p = await postRoom(c, "A", PA_FIX.room, {
      content: "Nhờ @cuc trả lời giúp",
      flow_id: f.run.flowId,
    });
    expect(p.res.status).toBe(201);
    expect(p.processRunId).toBeNull();
    expect(await assignees(c, f.taskId)).toEqual(before);
    expect((await taskRow(c, f.taskId))?.status).toBe("open");
  });
  it("HUB-FR-111 · P2-15 · answer '' / 4 001 ký tự; forward note 501 ⇒ 400 VALIDATION_ERROR; task không đổi", async () => {
    needSchema(c.ready);
    const f = await askRun(c);
    for (const body of [{ answer: "" }, { answer: "x".repeat(4_001) }]) {
      const r = await answer(c, "A", f.taskId, body);
      expect([r.status, code(r)]).toEqual([400, "VALIDATION_ERROR"]);
    }
    const n = await forward(c, "A", f.taskId, PA.H.id, "n".repeat(501));
    expect([n.status, code(n)]).toEqual([400, "VALIDATION_ERROR"]);
    expect((await taskRow(c, f.taskId))?.status).toBe("open");
    expect((await assignees(c, f.taskId)).length).toBe(1);
  });
});
