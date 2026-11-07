// CR-123 · u15 · MỘT dạng boolean cho vế Có/Không của node Nếu (Luật GỐC 1): schema nhận boolean thật; "true"/"false" của def cũ ⇒ boolean khi đọc;
// luật lưu không còn chấp nhận chuỗi riêng cho dữ kiện boolean (hết "nới" ifBoolOk).
import { describe, expect, test } from "bun:test";
import { CONTRACTS_MANIFEST } from "../app-manifest";
import { flowDefIssues, parseFlowDef } from "./process-flowdef";
import { CondSchema, canonicalCondValue } from "./process-if";

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
const ifStage = (cond: unknown) =>
  stage("nhanh", {
    step: 0,
    executor: { kind: "if", when: { op: "and", conds: [cond] }, then_step: 1, else_step: null },
  });
const flow = (cond: unknown) => ({
  key: "duyet-hd",
  name: "Duyệt HĐ",
  app: "contracts",
  owner: "library",
  trigger: { event: "contract.submitted" },
  stages: [ifStage(cond), stage("xong", { step: 1, outcome: "approved" })],
});
const fact = (key: string, op: string, value: unknown) => ({
  from: { kind: "fact", key },
  op,
  value,
});
const issues = (raw: unknown): string[] => {
  const r = parseFlowDef(raw);
  if (!r.ok) return r.issues.map((i) => i.message);
  return r.legacy ? [] : flowDefIssues(r.def, CONTRACTS_MANIFEST.events).map((i) => i.rule);
};

describe("CondSchema · một dạng boolean", () => {
  test("nhận boolean thật; chuỗi / số vẫn nhận", () => {
    expect(CondSchema.parse(fact("new_partner", "eq", true)).value).toBe(true);
    expect(CondSchema.parse(fact("new_partner", "ne", false)).value).toBe(false);
    expect(CondSchema.parse(fact("deal", "eq", "buy")).value).toBe("buy");
    expect(CondSchema.parse(fact("total_value", "gt", 5)).value).toBe(5);
  });
  test('"true"/"false" của def cũ ở vế dữ kiện ⇒ boolean khi đọc, vế input/field giữ chuỗi', () => {
    expect(CondSchema.parse(fact("new_partner", "eq", "true")).value).toBe(true);
    expect(CondSchema.parse(fact("new_partner", "eq", "false")).value).toBe(false);
    expect(
      CondSchema.parse({ from: { kind: "input", key: "ghi_chu" }, op: "eq", value: "true" }).value,
    ).toBe("true");
    expect(canonicalCondValue({ kind: "fact" }, "true")).toBe(true);
    expect(canonicalCondValue({ kind: "field" }, "true")).toBe("true");
    expect(canonicalCondValue({ kind: "fact" }, "buy")).toBe("buy");
  });
});

describe("luật lưu vế Có/Không (dữ kiện boolean)", () => {
  test("boolean thật + eq/ne ⇒ hợp lệ; chuỗi cũ cũng hợp lệ SAU khi chuẩn hoá khi đọc", () => {
    expect(issues(flow(fact("new_partner", "eq", true)))).toEqual([]);
    expect(issues(flow(fact("new_partner", "ne", false)))).toEqual([]);
    expect(issues(flow(fact("new_partner", "eq", "true")))).toEqual([]);
  });
  test("chuỗi khác / số / phép thứ tự trên dữ kiện boolean ⇒ FLOW_WHEN_INVALID", () => {
    expect(issues(flow(fact("new_partner", "eq", "co")))).toContain("FLOW_WHEN_INVALID");
    expect(issues(flow(fact("new_partner", "eq", 1)))).toContain("FLOW_WHEN_INVALID");
    expect(issues(flow(fact("new_partner", "gt", true)))).toContain("FLOW_WHEN_INVALID");
  });
  test("boolean thật trên dữ kiện KHÔNG phải boolean ⇒ FLOW_WHEN_INVALID", () => {
    expect(issues(flow(fact("deal", "eq", true)))).toContain("FLOW_WHEN_INVALID");
  });
});
