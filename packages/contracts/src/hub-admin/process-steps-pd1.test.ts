// HUB-FR-144 · HUB-FR-145 · P-d1 contract (bổ sung cho acceptance PD-C06, PD-C15): `isIsoCalendarDate`, `waitStageIssues`,
// `escalateStageIssues` gọi trực tiếp + gộp nhiều issue / nhiều stage trong `processDefStageIssues`.
import { describe, expect, test } from "bun:test";
import { isIsoCalendarDate } from "../chat/processes";
import {
  type EscalateStageShape,
  escalateStageIssues,
  processDefStageIssues,
  type WaitStageShape,
  waitStageIssues,
} from "./process-steps";

const G1 = "00000000-0000-4000-8000-0000000d0001";
const G2 = "00000000-0000-4000-8000-0000000d0002";
const INPUTS = [{ key: "han", type: "date" }];

const wait = (o: Partial<WaitStageShape> = {}): WaitStageShape => ({
  key: "cho",
  real_action: false,
  after: { kind: "auto" },
  executor: { kind: "wait_until", from: { kind: "input", key: "han" }, offset_days: 0 },
  ...o,
});
const review = (escalate: EscalateStageShape["after"]["escalate"]): EscalateStageShape => ({
  key: "duyet",
  real_action: false,
  after: { kind: "review", group_id: G1, escalate },
});

describe("isIsoCalendarDate", () => {
  test("năm nhuận thế kỷ + năm 0–99 không bị đổi thành 19xx", () => {
    expect(["2000-02-29", "1900-02-29", "0050-01-31", "2026-04-31"].map(isIsoCalendarDate)).toEqual(
      [true, false, true, false],
    );
  });
});

describe("waitStageIssues", () => {
  test("time vắng (bản nháp chưa qua zod default) ⇒ hợp lệ; offset 1.5 / chuỗi ⇒ offset_days", () => {
    expect(waitStageIssues([wait()], INPUTS)).toEqual([]);
    for (const offset_days of [1.5, "3"]) {
      const st = wait({
        executor: { kind: "wait_until", from: { kind: "input", key: "han" }, offset_days },
      });
      expect(waitStageIssues([st], INPUTS)).toEqual([
        { path: "stages.0.executor.offset_days", rule: "WAIT_INVALID" },
      ]);
    }
  });
  test("nhiều lỗi một stage ⇒ đúng thứ tự bảng A2; real_action + sources chỉ một issue executor", () => {
    const st = wait({
      after: { kind: "review" },
      real_action: true,
      sources: [{}],
      executor: { kind: "wait_until", from: { kind: "const" }, offset_days: 999, time: "7h" },
    });
    expect(waitStageIssues([st], INPUTS).map((i) => i.path)).toEqual([
      "stages.0.after",
      "stages.0.executor.from",
      "stages.0.executor.offset_days",
      "stages.0.executor.time",
      "stages.0.executor",
    ]);
  });
  test("stage không phải wait_until ⇒ bỏ qua; nguồn field ở bước sau ⇒ from", () => {
    const agent = {
      key: "doc",
      real_action: true,
      after: { kind: "auto" },
      executor: { kind: "agent" },
    };
    expect(waitStageIssues([agent], INPUTS)).toEqual([]);
    const field = wait({
      executor: {
        kind: "wait_until",
        from: { kind: "field", stage_key: "doc", field: "ngay" },
        offset_days: 1,
      },
    });
    const later = {
      ...agent,
      real_action: false,
      output: { fields: [{ key: "ngay", type: "date" }] },
    };
    expect(waitStageIssues([field, later], INPUTS)).toEqual([
      { path: "stages.0.executor.from", rule: "WAIT_INVALID" },
    ]);
    expect(waitStageIssues([later, field], INPUTS)).toEqual([]);
  });
});

describe("escalateStageIssues", () => {
  test("null / vắng ⇒ []; Group khác + biên ⇒ []; after_h không nguyên ⇒ issue", () => {
    expect(escalateStageIssues([review(null), review(undefined)])).toEqual([]);
    expect(escalateStageIssues([review({ after_h: 4, group_id: G2 })])).toEqual([]);
    expect(escalateStageIssues([review({ after_h: 4.5, group_id: G2 })])).toEqual([
      { path: "stages.0.after.escalate", rule: "ESCALATE_INVALID" },
    ]);
  });
});

describe("processDefStageIssues · P-d1", () => {
  test("WAIT + ESCALATE gộp sau luật cũ, chỉ số stage đúng; vắng ctx vẫn kiểm nguồn field", () => {
    const bad = wait({ key: "cho2", after: { kind: "review" } });
    const issues = processDefStageIssues([review({ after_h: 24, group_id: G1 }), bad] as never, {
      inputs: INPUTS,
    });
    expect(issues).toEqual([
      { path: "stages.1.after", rule: "WAIT_INVALID" },
      { path: "stages.0.after.escalate", rule: "ESCALATE_INVALID" },
    ]);
    const field = wait({
      executor: {
        kind: "wait_until",
        from: { kind: "field", stage_key: "x", field: "y" },
        offset_days: 0,
      },
    });
    expect(processDefStageIssues([field] as never)).toEqual([
      { path: "stages.0.executor.from", rule: "WAIT_INVALID" },
    ]);
  });
  test("vắng ctx ⇒ bỏ kiểm nguồn input (plan-contract §3); có ctx ⇒ input không khai báo bị bắt", () => {
    const st = wait({
      executor: { kind: "wait_until", from: { kind: "input", key: "khong-co" }, offset_days: 0 },
    });
    expect(processDefStageIssues([st] as never)).toEqual([]);
    expect(processDefStageIssues([st] as never, { inputs: INPUTS })).toEqual([
      { path: "stages.0.executor.from", rule: "WAIT_INVALID" },
    ]);
  });
});
