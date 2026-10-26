// contract-flow S5 · unit: xem trước đường đi + reducer + kiểm + lỗi server (DTO thật của S2).
import { describe, expect, test } from "bun:test";
import type { FlowReviewStep, FlowStep } from "../api-flow";
import { buildWhen, nextApplicable, previewPath, whenParts } from "./flow-path";
import { flowReducer, newReview, serverIssues, validateFlow } from "./flow-state";

const G = "11111111-1111-4111-8111-111111111111";
const rv = (key: string, when: FlowReviewStep["when"] = null): FlowReviewStep => ({
  ...newReview([], G),
  key,
  name: key,
  when,
});
const steps: FlowStep[] = [
  rv("s0"),
  rv("acc", { op: "and", conds: [{ field: "deal", in: ["buy", "sell"] }] }),
  rv("ceo", {
    op: "or",
    conds: [
      { field: "deal", in: ["referral"] },
      { field: "total_value", op: "ge", value: 100 },
    ],
  }),
];
const run = (deal: "buy" | "sell" | "referral", value: number | null) =>
  previewPath(steps, { deal, value })
    .filter((p) => p.run)
    .map((p) => p.index);

describe("previewPath / nextApplicable", () => {
  test("bước 0 luôn chạy; AND theo loại; OR theo giá trị", () => {
    expect(run("buy", 50)).toEqual([0, 1]);
    expect(run("buy", 100)).toEqual([0, 1, 2]);
    expect(run("referral", 1)).toEqual([0, 2]);
  });
  test("giá trị trống vẫn cần bước có điều kiện giá trị", () => {
    expect(run("buy", null)).toEqual([0, 1, 2]);
  });
  test("gt / le / lt và AND giữa loại + giá trị", () => {
    const w = (op: "gt" | "le" | "lt") =>
      [
        rv("a"),
        rv("b", {
          op: "and",
          conds: [
            { field: "deal", in: ["sell"] },
            { field: "total_value", op, value: 10 },
          ],
        }),
      ] as FlowStep[];
    const at = (op: "gt" | "le" | "lt", v: number) =>
      nextApplicable(w(op), { deal: "sell", value: v }, 0);
    expect(at("lt", 10)).toBeNull();
    expect(at("lt", 9)).toBe(1);
    expect(at("le", 10)).toBe(1);
    expect(at("gt", 10)).toBeNull();
    expect(at("gt", 11)).toBe(1);
    expect(nextApplicable(w("lt"), { deal: "buy", value: 5 }, 0)).toBeNull();
  });
  test("Dify luôn chạy; conds rỗng = luôn cần", () => {
    const s: FlowStep[] = [
      rv("a"),
      { kind: "dify", key: "d", name: "d", workflow_key: "w", after: "auto" },
      rv("b", { op: "and", conds: [] }),
    ];
    expect(previewPath(s, { deal: "buy", value: 1 }).every((p) => p.run)).toBe(true);
  });
  test("whenParts / buildWhen khứ hồi", () => {
    const w = steps[2] as FlowReviewStep;
    const p = whenParts(w.when as NonNullable<typeof w.when>);
    expect(p).toEqual({ deal: ["referral"], value: { op: "ge", value: 100 } });
    expect(buildWhen("or", p.deal, p.value)).toEqual(w.when as NonNullable<typeof w.when>);
    expect(buildWhen("and", [], null).conds).toEqual([]);
  });
});

describe("flowReducer", () => {
  test("thêm tối đa 8, xoá/di chuyển không đụng bước 0", () => {
    let s: FlowStep[] = [rv("s0")];
    for (let i = 0; i < 10; i++) s = flowReducer(s, { type: "addReview" });
    expect(s.length).toBe(8);
    expect(new Set(s.map((x) => x.key)).size).toBe(8);
    expect(flowReducer(s, { type: "remove", index: 0 })).toBe(s);
    expect(flowReducer(s, { type: "move", index: 1, dir: -1 })).toBe(s);
    const moved = flowReducer(s, { type: "move", index: 1, dir: 1 });
    expect(moved[2]?.key).toBe(s[1]?.key);
    expect(flowReducer(s, { type: "remove", index: 3 }).length).toBe(7);
  });
  test("setWhen bỏ qua bước 0", () => {
    const s = [rv("s0"), rv("a")];
    const when = { op: "or" as const, conds: [{ field: "deal" as const, in: ["buy" as const] }] };
    expect(flowReducer(s, { type: "setWhen", index: 0, when })).toBe(s);
    const n = flowReducer(s, { type: "setWhen", index: 1, when });
    expect((n[1] as FlowReviewStep).when).toEqual(when);
  });
  test("addDify", () => {
    const n = flowReducer([rv("s0")], { type: "addDify", workflow_key: "w1", name: "W" });
    expect(n[1]?.kind).toBe("dify");
  });
});

describe("validateFlow", () => {
  test("mẫu hợp lệ", () => expect(validateFlow(steps)).toEqual([]));
  test("nhóm null (mẫu mặc định thiếu Group) bị chặn", () => {
    const s = [{ ...rv("s0"), department_group_id: null }];
    expect(validateFlow(s).map((i) => i.code)).toEqual(["GROUP_REQUIRED"]);
  });
  test("các lỗi trường", () => {
    const bad: FlowStep[] = [
      { ...rv("s0"), when: { op: "or", conds: [{ field: "deal", in: ["buy"] }] } },
      {
        ...rv("x"),
        name: " ",
        department_group_id: null,
        due_h: 3,
        remind_every_h: 2,
      },
      { ...rv("y"), escalate_group_id: G, when: { op: "and", conds: [] } },
      { kind: "dify", key: "d", name: "d", workflow_key: "w", after: "auto" },
      { ...rv("z"), when: { op: "and", conds: [{ field: "deal", in: ["buy"] }] } },
    ];
    const codes = validateFlow(bad).map((i) => `${i.index}:${i.code}`);
    expect(codes).toEqual(
      expect.arrayContaining([
        "0:FIRST_CONDITIONAL",
        "1:nameEmpty",
        "1:GROUP_REQUIRED",
        "1:DUE_RANGE",
        "1:REMIND_RANGE",
        "2:ESCALATE_SAME_GROUP",
        "2:whenEmpty",
        "4:AFTER_DIFY_CONDITIONAL",
      ]),
    );
  });
  test("hạn tối đa 2160, nhắc 4–168", () => {
    expect(validateFlow([{ ...rv("a"), due_h: 2160, remind_every_h: 168 }])).toEqual([]);
    expect(validateFlow([{ ...rv("a"), due_h: 2161 }]).length).toBe(1);
  });
  test("quá 8 bước", () => {
    const many = Array.from({ length: 9 }, (_, i) => rv(`k${i}`));
    expect(validateFlow(many).some((i) => i.code === "STEPS_MAX")).toBe(true);
  });
});

describe("serverIssues", () => {
  test("đọc {path, rule} của APPROVAL_FLOW_INVALID", () => {
    const r = serverIssues({
      details: {
        issues: [
          { path: "steps.2.due_h", rule: "DUE_RANGE" },
          { path: "steps", rule: "STEPS_MAX" },
        ],
      },
    });
    expect(r[0]).toMatchObject({ index: 2, field: "due_h", code: "DUE_RANGE" });
    expect(r[1]).toMatchObject({ index: null, code: "STEPS_MAX" });
    expect(serverIssues(new Error("x"))).toEqual([]);
  });
});
