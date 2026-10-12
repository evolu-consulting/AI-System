// HUB-FR-118 · HUB-BR-38(d) · AC-PB2-06/07 · test-plan-cases §3.1 `back-rules` (RB-01…RB-11): hàm thuần
// `processes/gates/back.rules.ts` (plan §2, D7, D8). Module vắng ⇒ đỏ ở `fn(...)`.
import { describe, expect, it } from "bun:test";
import { fn, loadBackRules } from "../_support/_modules";

const m = await loadBackRules();
const stage = { step: 3, backToSteps: [1] };

describe("RB · kiểm quyết định quay lại [HUB-FR-118]", () => {
  it("HUB-FR-118 · RB-01 · fail + back_to_step thiếu góp ý / góp ý toàn khoảng trắng ⇒ FEEDBACK_REQUIRED (góp ý kiểm trước)", () => {
    const c = fn(m, "backDecisionCheck");
    expect(c({ result: "fail", back_to_step: 1 }, stage)).toBe("FEEDBACK_REQUIRED");
    expect(c({ result: "fail", back_to_step: 1, feedback: "   " }, stage)).toBe(
      "FEEDBACK_REQUIRED",
    );
    expect(c({ result: "fail", back_to_step: 2 }, stage)).toBe("FEEDBACK_REQUIRED");
  });
  it("HUB-FR-118 · RB-02 · pass + back_to_step ⇒ BACK_TARGET_INVALID", () => {
    expect(
      fn(m, "backDecisionCheck")({ result: "pass", back_to_step: 1, feedback: "x" }, stage),
    ).toBe("BACK_TARGET_INVALID");
  });
  it("HUB-FR-118 · RB-03 · back_to_step ∉ back_to_steps / back_to_steps rỗng ⇒ BACK_TARGET_INVALID", () => {
    const c = fn(m, "backDecisionCheck");
    expect(c({ result: "fail", back_to_step: 2, feedback: "x" }, stage)).toBe(
      "BACK_TARGET_INVALID",
    );
    expect(
      c({ result: "fail", back_to_step: 0, feedback: "x" }, { step: 3, backToSteps: [] }),
    ).toBe("BACK_TARGET_INVALID");
  });
  it("HUB-FR-118 · RB-04 · hợp lệ ⇒ ok; fail không back_to_step ⇒ ok (làm lại như cũ)", () => {
    const c = fn(m, "backDecisionCheck");
    expect(c({ result: "fail", back_to_step: 1, feedback: "Sai số" }, stage)).toBe("ok");
    expect(c({ result: "fail", feedback: "x" }, stage)).toBe("ok");
  });
});

describe("RB · kế hoạch reset (D7) [AC-PB2-06]", () => {
  it("AC-PB2-06 · RB-05 · steps [0,1,2,3], đích 1 ⇒ [1 queued r2 'Sai số', 2 pending r2 null, 3 pending r2 null] (idx tăng)", () => {
    const got = fn(
      m,
      "backResetPlan",
    )({
      steps: [0, 1, 2, 3],
      target: 1,
      feedback: "Sai số",
      stages: [
        { idx: 0, status: "done", round: 1 },
        { idx: 1, status: "done", round: 1 },
        { idx: 2, status: "done", round: 1 },
        { idx: 3, status: "waiting_review", round: 1 },
      ],
    });
    expect(got).toEqual([
      { idx: 1, status: "queued", round: 2, feedback: "Sai số" },
      { idx: 2, status: "pending", round: 2, feedback: null },
      { idx: 3, status: "pending", round: 2, feedback: null },
    ]);
  });
  it("AC-PB2-06 · RB-06 · stage bước > X còn pending (chưa chạy) ⇒ round giữ, pending, feedback null", () => {
    const got = fn(
      m,
      "backResetPlan",
    )({
      steps: [0, 1, 2, 3, 4],
      target: 1,
      feedback: "x",
      stages: [
        { idx: 0, status: "done", round: 1 },
        { idx: 1, status: "done", round: 1 },
        { idx: 2, status: "done", round: 1 },
        { idx: 3, status: "waiting_review", round: 1 },
        { idx: 4, status: "pending", round: 1 },
      ],
    });
    expect(got.at(-1)).toEqual({ idx: 4, status: "pending", round: 1, feedback: null });
  });
  it("AC-PB2-06 · RB-07 · song song steps [0,1,1,2], đích 1 ⇒ idx 1, 2 queued round+1 cùng góp ý; idx 3 pending round giữ", () => {
    const got = fn(
      m,
      "backResetPlan",
    )({
      steps: [0, 1, 1, 2],
      target: 1,
      feedback: "Thiếu test",
      stages: [
        { idx: 0, status: "done", round: 1 },
        { idx: 1, status: "done", round: 1 },
        { idx: 2, status: "done", round: 1 },
        { idx: 3, status: "pending", round: 1 },
      ],
    });
    expect(got).toEqual([
      { idx: 1, status: "queued", round: 2, feedback: "Thiếu test" },
      { idx: 2, status: "queued", round: 2, feedback: "Thiếu test" },
      { idx: 3, status: "pending", round: 1, feedback: null },
    ]);
  });
  it("AC-PB2-06 · RB-08 · round đã 2 ⇒ 3 (cộng dồn)", () => {
    const got = fn(
      m,
      "backResetPlan",
    )({
      steps: [0, 1],
      target: 0,
      feedback: "x",
      stages: [
        { idx: 0, status: "done", round: 2 },
        { idx: 1, status: "waiting_review", round: 2 },
      ],
    });
    expect(got).toEqual([
      { idx: 0, status: "queued", round: 3, feedback: "x" },
      { idx: 1, status: "pending", round: 3, feedback: null },
    ]);
  });
  it("AC-PB2-06 · RB-11 · không trả phần tử cho stage bước < X (G3)", () => {
    const got = fn(
      m,
      "backResetPlan",
    )({
      steps: [0, 1, 2],
      target: 1,
      feedback: "x",
      stages: [
        { idx: 0, status: "done", round: 1 },
        { idx: 1, status: "done", round: 1 },
        { idx: 2, status: "waiting_review", round: 1 },
      ],
    }) as { idx: number }[];
    expect(got.map((r) => r.idx)).toEqual([1, 2]);
  });
});

describe("RB · trần quay lại (D8) [AC-PB2-07]", () => {
  it("AC-PB2-07 · RB-09 · backAllowed {2,3} true; {3,3} false; {3,4} true", () => {
    const a = fn(m, "backAllowed");
    expect([
      a({ backRounds: 2, backLimit: 3 }),
      a({ backRounds: 3, backLimit: 3 }),
      a({ backRounds: 3, backLimit: 4 }),
    ]).toEqual([true, false, true]);
  });
  it("AC-PB2-07 · RB-10 · backRoundsLeft {0,3}=3, {3,3}=0, {5,3}=0", () => {
    const l = fn(m, "backRoundsLeft");
    expect([
      l({ backRounds: 0, backLimit: 3 }),
      l({ backRounds: 3, backLimit: 3 }),
      l({ backRounds: 5, backLimit: 3 }),
    ]).toEqual([3, 0, 0]);
  });
});
