// contract-flow S5 · unit: xem trước đường đi + reducer + kiểm + lỗi server.
import { describe, expect, test } from "bun:test";
import type { FlowStep, ReviewStep } from "../api-flow";
import { nextApplicable, previewPath } from "./flow-path";
import { flowReducer, newReview, serverIssues, validateFlow } from "./flow-state";

const rv = (key: string, when: ReviewStep["when"] = null): ReviewStep => ({
  ...newReview([], "g1"),
  key,
  name: key,
  when,
});
const steps: FlowStep[] = [
  rv("s0"),
  rv("acc", { op: "and", deal: ["buy", "sell"] }),
  rv("ceo", { op: "or", deal: ["referral"], value: { cmp: "gte", amount: 100 } }),
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
  test("lt và AND giữa loại + giá trị", () => {
    const s = [rv("a"), rv("b", { op: "and", deal: ["sell"], value: { cmp: "lt", amount: 10 } })];
    expect(nextApplicable(s, { deal: "sell", value: 5 }, 0)).toBe(1);
    expect(nextApplicable(s, { deal: "sell", value: 10 }, 0)).toBeNull();
    expect(nextApplicable(s, { deal: "buy", value: 5 }, 0)).toBeNull();
  });
  test("Dify luôn chạy; when rỗng = luôn cần", () => {
    const s: FlowStep[] = [
      rv("a"),
      { kind: "dify", key: "d", name: "d", workflow_key: "w", after: "auto" },
      rv("b", { op: "and" }),
    ];
    expect(previewPath(s, { deal: "buy", value: 1 }).every((p) => p.run)).toBe(true);
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
    expect(flowReducer(s, { type: "setWhen", index: 0, when: { op: "or" } })).toBe(s);
    const n = flowReducer(s, { type: "setWhen", index: 1, when: { op: "or", deal: ["buy"] } });
    expect((n[1] as ReviewStep).when?.deal).toEqual(["buy"]);
  });
  test("addDify", () => {
    const n = flowReducer([rv("s0")], { type: "addDify", workflow_key: "w1", name: "W" });
    expect(n[1]?.kind).toBe("dify");
  });
});

describe("validateFlow", () => {
  test("mẫu hợp lệ", () => expect(validateFlow(steps)).toEqual([]));
  test("các lỗi trường", () => {
    const bad: FlowStep[] = [
      { ...rv("s0"), when: { op: "or", deal: ["buy"] } },
      {
        ...rv("x"),
        name: " ",
        department_group_id: "",
        due_h: 0,
        remind_every_h: 2,
        escalate_group_id: "",
      },
      { ...rv("y"), escalate_group_id: "g1", when: { op: "and" } },
    ];
    const codes = validateFlow(bad).map((i) => `${i.index}:${i.code}`);
    expect(codes).toEqual(
      expect.arrayContaining([
        "0:firstWhen",
        "1:nameEmpty",
        "1:deptEmpty",
        "1:dueRange",
        "1:remindRange",
        "2:escalateSame",
        "2:whenEmpty",
      ]),
    );
  });
  test("quá 8 bước", () => {
    const many = Array.from({ length: 9 }, (_, i) => rv(`k${i}`));
    expect(validateFlow(many).some((i) => i.code === "tooMany")).toBe(true);
  });
});

describe("serverIssues", () => {
  test("đọc path steps.N.field", () => {
    const r = serverIssues({
      details: {
        issues: [
          { path: ["steps", 2, "due_h"], message: "sai" },
          { path: [], message: "x" },
        ],
      },
    });
    expect(r[0]).toMatchObject({ index: 2, field: "due_h", message: "sai" });
    expect(r[1]?.index).toBeNull();
    expect(serverIssues(new Error("x"))).toEqual([]);
  });
});
