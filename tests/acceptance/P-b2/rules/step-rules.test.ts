// HUB-FR-106 · HUB-BR-38(a,b) · AC-PB2-01/02/05 · test-plan-cases §3.1 `step-rules` (RS-01…RS-14): hàm thuần
// `processes/domain/runs/step.rules.ts` (plan §2, D1/D2/D9). Module vắng ⇒ đỏ ở `fn(...)`.
import { describe, expect, it } from "bun:test";
import { fn, loadStepRules } from "../_support/_modules";

const m = await loadStepRules();
const B = "b2b20000-0000-4000-8000-000000000b0b";
const T = "b2b20000-0000-4000-8000-000000000c0c";

describe("RS · bước + join [HUB-FR-106][HUB-BR-38]", () => {
  it("HUB-FR-106 · RS-01 · steps [0,1,1,2]: stageIdxsOfStep/stepCountOf/firstIdxOfStep/priorStageIdxs (R05); cũ [0,1,2]", () => {
    const s = [0, 1, 1, 2];
    expect(fn(m, "stageIdxsOfStep")(s, 1)).toEqual([1, 2]);
    expect(fn(m, "stepCountOf")(s)).toBe(3);
    expect(fn(m, "firstIdxOfStep")(s, 1)).toBe(1);
    expect(fn(m, "priorStageIdxs")(s, 3)).toEqual([0, 1, 2]);
    expect(fn(m, "priorStageIdxs")(s, 2)).toEqual([0]);
    expect(fn(m, "priorStageIdxs")([0, 1, 2], 2)).toEqual([0, 1]);
  });
  it("HUB-FR-106 · RS-02 · stageGateStatus: run kết thúc giữ run; pending/queued/running ⇒ running; waiting_*/needs ⇒ như tên; done; cancelled/failed ⇒ cancelled", () => {
    const g = fn(m, "stageGateStatus");
    expect([g("cancelled", "waiting_review"), g("done", "running")]).toEqual(["cancelled", "done"]);
    expect(["pending", "queued", "running"].map((s) => g("running", s))).toEqual([
      "running",
      "running",
      "running",
    ]);
    expect(
      ["waiting_review", "waiting_answer", "needs_decision"].map((s) => g("running", s)),
    ).toEqual(["waiting_review", "waiting_answer", "needs_decision"]);
    expect([g("running", "done"), g("running", "cancelled"), g("running", "failed")]).toEqual([
      "done",
      "cancelled",
      "cancelled",
    ]);
  });
  it("HUB-FR-106 · RS-03 · runStatusOf ưu tiên needs_decision > running > waiting_answer > waiting_review; [done,done] ⇒ step_done", () => {
    const r = fn(m, "runStatusOf");
    expect([
      r(["needs_decision", "running"]),
      r(["waiting_review", "running"]),
      r(["waiting_review", "waiting_answer"]),
      r(["done", "waiting_review"]),
      r(["queued", "done"]),
      r(["done", "done"]),
    ]).toEqual([
      "needs_decision",
      "running",
      "waiting_answer",
      "waiting_review",
      "running",
      "step_done",
    ]);
  });
  it("AC-PB2-02 · RS-04 · stepJoin bước 1 {1:done, 2:waiting_review} ⇒ wait", () => {
    const statuses = new Map([
      [1, "done"],
      [2, "waiting_review"],
    ]);
    expect(fn(m, "stepJoin")({ steps: [0, 1, 1, 2], step: 1, statuses })).toEqual({ kind: "wait" });
  });
  it("AC-PB2-02 · RS-05 · stepJoin bước 1 {1:done, 2:done} ⇒ next_step 2 queue [3]", () => {
    const statuses = new Map([
      [1, "done"],
      [2, "done"],
    ]);
    expect(fn(m, "stepJoin")({ steps: [0, 1, 1, 2], step: 1, statuses })).toEqual({
      kind: "next_step",
      step: 2,
      queue: [3],
    });
  });
  it("AC-PB2-02 · RS-06 · stepJoin bước cuối {3:done} ⇒ finish", () => {
    expect(
      fn(m, "stepJoin")({ steps: [0, 1, 1, 2], step: 2, statuses: new Map([[3, "done"]]) }),
    ).toEqual({
      kind: "finish",
    });
  });
  it("AC-PB2-02 · RS-07 · steps [0,1,1,1,2], bước 0 xong ⇒ next_step queue [1,2,3] (≤3)", () => {
    expect(
      fn(m, "stepJoin")({ steps: [0, 1, 1, 1, 2], step: 0, statuses: new Map([[0, "done"]]) }),
    ).toEqual({
      kind: "next_step",
      step: 1,
      queue: [1, 2, 3],
    });
  });
  it("AC-PB2-02 · RS-08 · thiếu hàng statuses cho 1 stage của bước ⇒ wait (không join sớm)", () => {
    expect(
      fn(m, "stepJoin")({ steps: [0, 1, 1, 2], step: 1, statuses: new Map([[1, "done"]]) }),
    ).toEqual({
      kind: "wait",
    });
  });
  it("HUB-FR-106 · RS-09 · pickDecisionStage: cũ nhất; want=1 ⇒ 1; want không mở ⇒ null; [] ⇒ null", () => {
    const p = fn(m, "pickDecisionStage");
    const open = [
      { stageIdx: 2, createdAt: "2026-10-12T10:00:05.000Z" },
      { stageIdx: 1, createdAt: "2026-10-12T10:00:09.000Z" },
    ];
    expect([p(open), p(open, 1), p(open, 3), p([])]).toEqual([2, 1, null, null]);
  });
});

describe("RS · real_action theo bước [AC-PB2-05][HUB-BR-38]", () => {
  const rv = (
    o: Partial<{ after: string; status: string; passedBy: string | null; passedAt: string | null }>,
  ) => ({
    after: "review",
    status: "done",
    passedBy: B,
    passedAt: "2026-10-12T10:00:00.000Z",
    ...o,
  });
  it("AC-PB2-05 · RS-12 · realActionStepCheck: [] / có auto / review chưa done / thiếu passedBy ⇒ {ok:false}", () => {
    const r = fn(m, "realActionStepCheck");
    expect(r([])).toEqual({ ok: false });
    expect(r([rv({}), rv({ after: "auto" })])).toEqual({ ok: false });
    expect(r([rv({}), rv({ status: "waiting_review", passedBy: null, passedAt: null })])).toEqual({
      ok: false,
    });
    expect(r([rv({ passedBy: null })])).toEqual({ ok: false });
  });
  it("AC-PB2-05 · RS-13 · 2 review done (B 10:00, T 10:05) ⇒ ok, passedBy = T (Đạt MUỘN nhất)", () => {
    expect(
      fn(
        m,
        "realActionStepCheck",
      )([rv({}), rv({ passedBy: T, passedAt: "2026-10-12T10:05:00.000Z" })]),
    ).toEqual({ ok: true, passedBy: T });
  });
  it("AC-PB2-01 · RS-14 · 1 review done (mỗi stage một bước, def cũ) ⇒ ok, passedBy = người đó", () => {
    expect(fn(m, "realActionStepCheck")([rv({})])).toEqual({ ok: true, passedBy: B });
  });
});
