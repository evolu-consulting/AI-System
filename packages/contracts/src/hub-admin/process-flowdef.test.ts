// CR-122 · FLOW2-FR-01/02/12/15 · `FlowDefSchema` / `flowDefIssues` / `parseFlowDef` (def cũ không trigger vẫn chạy).
import { describe, expect, test } from "bun:test";
import { CONTRACTS_MANIFEST } from "../app-manifest";
import { flowDefIssues, parseFlowDef } from "./process-flowdef";

const G = "00000000-0000-4000-8000-0000000c0001";
const stage = (key: string, o: Record<string, unknown> = {}) => ({
  key,
  name: key.toUpperCase(),
  executor: { kind: "agent", agent_id: G },
  instruction: "",
  output: { filename: "a.md", template: "# a", required_sections: ["a"], fields: [] },
  after: { kind: "auto" },
  real_action: false,
  answerer: { kind: "starter" },
  token_budget: null,
  ...o,
});
const flow = (o: Record<string, unknown> = {}) => ({
  key: "duyet-hd",
  name: "Duyệt HĐ",
  app: "contracts",
  owner: "library",
  trigger: {
    event: "contract.submitted",
    when: { op: "and", conds: [{ fact: "total_value", op: "ge", value: 100_000_000 }] },
  },
  stages: [stage("duyet", { step: 0 }), stage("xong", { step: 1, outcome: "approved" })],
  ...o,
});
const rules = (raw: unknown) => {
  const r = parseFlowDef(raw);
  return r.ok ? [] : r.issues.map((i) => i.message);
};
const events = CONTRACTS_MANIFEST.events;

describe("FLOW2-FR-01/02 · FlowDef", () => {
  test("hợp lệ: 1 trigger, ≥ 1 Kết thúc ⇒ ok, không legacy, mặc định source/version null", () => {
    const r = parseFlowDef(flow());
    expect(r.ok && !r.legacy).toBe(true);
    if (r.ok && !r.legacy) {
      expect(r.def.source).toBeNull();
      expect(r.def.version).toBeNull();
      expect(r.def.stages[1]?.outcome).toBe("approved");
      expect(flowDefIssues(r.def, events)).toEqual([]);
    }
  });
  test("không có node Kết thúc ⇒ FLOW_NO_FINISH", () => {
    expect(rules(flow({ stages: [stage("a")] }))).toContain("FLOW_NO_FINISH");
  });
  test("> 20 bước ⇒ FLOW_TOO_MANY_STEPS, đúng 20 ⇒ hợp lệ", () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        stage(`s${i}`, { step: i, ...(i === n - 1 ? { outcome: "approved" } : {}) }),
      );
    expect(rules(flow({ stages: many(21) }))).toContain("FLOW_TOO_MANY_STEPS");
    expect(rules(flow({ stages: many(20) }))).toEqual([]);
  });
  test("next_step lùi/vượt ⇒ FLOW_NEXT_STEP_INVALID, Kết thúc có next_step ⇒ FLOW_FINISH_NEXT", () => {
    const back = [
      stage("a", { step: 0 }),
      stage("b", { step: 1, next_step: 0 }),
      stage("c", { step: 2, outcome: "approved", next_step: 3 }),
    ];
    const got = rules(flow({ stages: back }));
    expect(got).toContain("FLOW_NEXT_STEP_INVALID");
    expect(got).toContain("FLOW_FINISH_NEXT");
    const merge = [
      stage("a", { step: 0, next_step: 2 }),
      stage("b", { step: 1 }),
      stage("c", { step: 2, outcome: "approved" }),
    ];
    expect(rules(flow({ stages: merge }))).toEqual([]);
  });
  test("hình sai: hai trigger (mảng), sự kiện sai dạng, owner lạ, outcome sai khoá ⇒ từ chối", () => {
    expect(parseFlowDef(flow({ trigger: [{ event: "contract.submitted" }] })).ok).toBe(false);
    expect(parseFlowDef(flow({ trigger: { event: "Submitted" } })).ok).toBe(false);
    expect(parseFlowDef(flow({ owner: "tenant" })).ok).toBe(false);
    expect(parseFlowDef(flow({ stages: [stage("x", { outcome: "Đã duyệt" })] })).ok).toBe(false);
  });
  test("thư viện có source ⇒ FLOW_SOURCE_OWNER; bản công ty có source ⇒ hợp lệ", () => {
    const src = { flow_key: "hd-mac-dinh", version: 3 };
    expect(rules(flow({ source: src }))).toContain("FLOW_SOURCE_OWNER");
    expect(rules(flow({ owner: "company", source: src }))).toEqual([]);
  });
  test("theo manifest: sự kiện lạ, outcome không thuộc sự kiện, dữ kiện/kiểu sai ⇒ lỗi tương ứng", () => {
    const base = parseFlowDef(flow());
    if (!base.ok || base.legacy) throw new Error("fixture");
    const d = base.def;
    expect(flowDefIssues({ ...d, trigger: { event: "post.created" } }, events)[0]?.rule).toBe(
      "FLOW_EVENT_UNKNOWN",
    );
    const badOut = { ...d, stages: [{ ...d.stages[0], outcome: "shown" }] } as typeof d;
    expect(flowDefIssues(badOut, events).map((i) => i.rule)).toContain("FLOW_OUTCOME_UNKNOWN");
    const when = {
      op: "or" as const,
      conds: [
        { fact: "khong_co", op: "eq" as const, value: "x" },
        {
          op: "and" as const,
          conds: [
            { fact: "total_value", op: "ge" as const, value: "nhieu" },
            { fact: "deal", op: "in" as const, value: ["buy"] },
            { fact: "new_partner", op: "eq" as const, value: true },
          ],
        },
      ],
    };
    const got = flowDefIssues({ ...d, trigger: { event: d.trigger.event, when } }, events);
    expect(got.map((i) => i.path)).toEqual([
      "trigger.when.conds.0",
      "trigger.when.conds.1.conds.0",
    ]);
  });
  test("điều kiện lồng 2 cấp ⇒ từ chối (chỉ 1 cấp)", () => {
    const deep = {
      op: "and",
      conds: [
        { op: "or", conds: [{ op: "and", conds: [{ fact: "deal", op: "eq", value: "buy" }] }] },
      ],
    };
    expect(parseFlowDef(flow({ trigger: { event: "contract.submitted", when: deep } })).ok).toBe(
      false,
    );
  });
});

describe("FLOW2-FR-04 · def cũ (snapshot trước CR-122)", () => {
  test("không trigger, có slot/after.branch ⇒ hợp lệ legacy, giữ trường khác, không áp luật mới", () => {
    const old = {
      key: "hd-mac-dinh",
      slot: "contracts.approval",
      stages: [stage("route", { slot: { kind: "contracts-route" } })],
    };
    const r = parseFlowDef(old);
    expect(r.ok && r.legacy).toBe(true);
    if (r.ok && r.legacy) {
      expect(r.def.key).toBe("hd-mac-dinh");
      expect(r.def.stages).toHaveLength(1);
    }
  });
  test("def cũ stages rỗng / không phải object ⇒ lỗi", () => {
    expect(parseFlowDef({ stages: [] }).ok).toBe(false);
    expect(parseFlowDef(null).ok).toBe(false);
  });
});
