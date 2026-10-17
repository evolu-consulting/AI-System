// HUB-FR-145 · HUB-BR-43 · AC-H42 · PD-R23 — `domain/defs/escalate-def.rules.ts` (plan-domain §4.7, plan-addendum A8
// #57). test-plan-rules PD-U67…U69. Hàm thuần báo cả 3 điều kiện; qua API afterH/`auto` bị zod chặn 400 (PD-C04, I47).
import { describe, expect, it } from "bun:test";
import { domainFn } from "../_support/modules";
import { G1, G2, type StageShape, st } from "./_defs";

const REL = "defs/escalate-def.rules.ts";
const E = "ESCALATE_INVALID";

/** index 0: agent auto không escalate; index 1: stage review G1 (ghi đè từng ca). */
const def = (o: Partial<StageShape> = {}): StageShape[] => [
  st({ key: "doc", step: 0 }),
  st({ key: "duyet", step: 1, after: "review", reviewGroupId: G1, ...o }),
];
const bad = [{ path: "stages.1.after.escalate", rule: E }];

describe("escalateStageIssues [PD-R23]", () => {
  it("HUB-FR-145 · AC-H42 · PD-U67 · escalate null ⇒ []; {afterH:24, groupId:G2} ở review G1 ⇒ []; biên afterH 4 / 2160 ⇒ []", async () => {
    const f = await domainFn(REL, "escalateStageIssues");
    expect(f(def({ escalate: null }))).toEqual([]);
    expect(f(def({ escalate: { afterH: 24, groupId: G2 } }))).toEqual([]);
    expect(f(def({ escalate: { afterH: 4, groupId: G2 } }))).toEqual([]);
    expect(f(def({ escalate: { afterH: 2160, groupId: G2 } }))).toEqual([]);
  });
  it("HUB-BR-43 · AC-H42 · PD-U68 · groupId = Group duyệt / escalate ở stage auto / afterH 3 / afterH 2161 ⇒ ESCALATE_INVALID path stages.<i>.after.escalate", async () => {
    const f = await domainFn(REL, "escalateStageIssues");
    const cases: [string, Partial<StageShape>][] = [
      ["trùng Group duyệt", { escalate: { afterH: 24, groupId: G1 } }],
      ["stage auto", { after: "auto", reviewGroupId: null, escalate: { afterH: 24, groupId: G2 } }],
      ["afterH 3", { escalate: { afterH: 3, groupId: G2 } }],
      ["afterH 2161", { escalate: { afterH: 2161, groupId: G2 } }],
    ];
    for (const [ca, o] of cases) expect({ ca, out: f(def(o)) }).toEqual({ ca, out: bad });
  });
});

describe("escalateGroupRefs [PD-R23, plan §4.9]", () => {
  it("HUB-FR-145 · PD-U69 · 2 stage có escalate ⇒ [{path:stages.<i>.after.escalate.group_id, groupId}] theo thứ tự i; stage không escalate bỏ qua", async () => {
    const f = await domainFn(REL, "escalateGroupRefs");
    const G3 = "a5d00000-0000-4000-8000-0000000000a3";
    const stages = [
      st({
        key: "a",
        step: 0,
        after: "review",
        reviewGroupId: G1,
        escalate: { afterH: 24, groupId: G2 },
      }),
      st({ key: "b", step: 1 }),
      st({
        key: "c",
        step: 2,
        after: "review",
        reviewGroupId: G1,
        escalate: { afterH: 48, groupId: G3 },
      }),
    ];
    expect(f(stages)).toEqual([
      { path: "stages.0.after.escalate.group_id", groupId: G2 },
      { path: "stages.2.after.escalate.group_id", groupId: G3 },
    ]);
    expect(f([st({ key: "a", step: 0 })])).toEqual([]);
  });
});
