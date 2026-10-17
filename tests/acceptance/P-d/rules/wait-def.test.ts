// HUB-FR-144 · HUB-BR-42 · AC-H41 · PD-R17 — `domain/defs/wait-def.rules.ts` `waitStageIssues(stages, inputs)`
// (plan-domain §4.6; path theo plan-addendum A2 + A8 #58, thắng "stages.<i>.executor" của §4.6). PD-U59…U61b.
import { describe, expect, it } from "bun:test";
import { domainFn } from "../_support/modules";
import {
  fieldFrom,
  G1,
  INPUTS,
  inputFrom,
  type StageShape,
  st,
  type WaitFrom,
  waitSt,
} from "./_defs";

const load = () => domainFn("defs/wait-def.rules.ts", "waitStageIssues");
const W = "WAIT_INVALID";

/** Bước 0 `doc` (agent, review, có nguồn — stage không phải wait ⇒ không xét), bước 1 `cho` (wait, index 1) + `song`
 *  (cùng bước 1), bước 2 `sau`. Hai stage agent đều có field `ngay` kiểu date. */
const def = (
  wait: Partial<StageShape> = {},
  w: Partial<NonNullable<StageShape["wait"]>> = {},
): StageShape[] => [
  st({
    key: "doc",
    step: 0,
    after: "review",
    reviewGroupId: G1,
    realAction: true,
    hasSources: true,
    hasMustKnow: true,
    fields: [
      { key: "ngay_het_han", type: "date", required: true },
      { key: "so_tien", type: "number", required: true },
    ],
  }),
  waitSt({ key: "cho", step: 1, ...wait }, w),
  st({ key: "song", step: 1, fields: [{ key: "ngay", type: "date", required: true }] }),
  st({ key: "sau", step: 2, fields: [{ key: "ngay", type: "date", required: true }] }),
];
const issue = (path: string) => [{ path: `stages.1.${path}`, rule: W }];

describe("waitStageIssues — hợp lệ [PD-R17]", () => {
  it("HUB-FR-144 · PD-U59 · wait từ field stage bước nhỏ hơn (date) / từ input `han` (date) ⇒ []; stage agent có nguồn/realAction không bị xét", async () => {
    const f = await load();
    expect(f(def(), INPUTS)).toEqual([]);
    expect(f(def({}, { from: inputFrom("han"), offsetDays: 0 }), INPUTS)).toEqual([]);
    const two = [
      ...def(),
      waitSt({ key: "cho2", step: 3 }, { from: fieldFrom("sau", "ngay"), time: "23:59" }),
    ];
    expect(f(two, INPUTS)).toEqual([]);
  });
});

describe("waitStageIssues — ràng buộc stage [PD-R17, A2]", () => {
  it("HUB-FR-144 · AC-H41 · PD-U60 · after:review ⇒ path stages.<i>.after", async () => {
    const f = await load();
    expect(f(def({ after: "review", reviewGroupId: G1 }), INPUTS)).toEqual(issue("after"));
  });
  it("HUB-FR-144 · AC-H41 · PD-U60 · realAction / hasSources / hasMustKnow / hasAutofix ⇒ path stages.<i>.executor", async () => {
    const f = await load();
    const flags: Partial<StageShape>[] = [
      { realAction: true },
      { hasSources: true },
      { hasMustKnow: true },
      { hasAutofix: true },
    ];
    for (const o of flags)
      expect({ o, out: f(def(o), INPUTS) }).toEqual({ o, out: issue("executor") });
  });
});

describe("waitStageIssues — nguồn ngày [PD-R13, PD-R17, A2]", () => {
  it("HUB-FR-144 · AC-H41 · PD-U61 · input vắng / text; field cùng bước / bước lớn hơn / field vắng / field number ⇒ path stages.<i>.executor.from (6 ca)", async () => {
    const f = await load();
    const bad: [string, WaitFrom][] = [
      ["input vắng", inputFrom("khong_co")],
      ["input text", inputFrom("ghi_chu")],
      ["field stage cùng bước", fieldFrom("song", "ngay")],
      ["field stage bước lớn hơn", fieldFrom("sau", "ngay")],
      ["field vắng", fieldFrom("doc", "khong_co")],
      ["field number", fieldFrom("doc", "so_tien")],
    ];
    for (const [ca, from] of bad) {
      expect({ ca, out: f(def({}, { from }), INPUTS) }).toEqual({
        ca,
        out: issue("executor.from"),
      });
    }
  });
  it("HUB-FR-144 · PD-U61b · bản nháp chưa qua zod: offsetDays 366/−366 ⇒ .executor.offset_days; time 24:00/9:00 ⇒ .executor.time; biên ±365 ⇒ []", async () => {
    const f = await load();
    for (const offsetDays of [366, -366]) {
      expect({ offsetDays, out: f(def({}, { offsetDays }), INPUTS) }).toEqual({
        offsetDays,
        out: issue("executor.offset_days"),
      });
    }
    for (const time of ["24:00", "9:00"]) {
      expect({ time, out: f(def({}, { time }), INPUTS) }).toEqual({
        time,
        out: issue("executor.time"),
      });
    }
    for (const offsetDays of [365, -365]) expect(f(def({}, { offsetDays }), INPUTS)).toEqual([]);
    expect(f(def({}, { time: "00:00" }), INPUTS)).toEqual([]);
  });
});
