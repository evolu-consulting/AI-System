// CR-125 · «Quy trình con» — luật thuần: kết quả lượt con, field `sub_*`, nối đầu vào (id nguồn autoMapInputs), vòng / độ sâu.
import { describe, expect, it } from "bun:test";
import { callIssue, childSettle, mappedValues, subFields } from "./subprocess.rules";

describe("CR-125 · subprocess.rules", () => {
  it("childSettle: huỷ / lỗi / Kết thúc từ chối / Duyệt từ chối / xong / chưa xong", () => {
    const s = (
      status: string,
      endOutcome: string | null = null,
      lastDecision: string | null = null,
    ) => childSettle({ status, endOutcome, lastDecision });
    expect(s("cancelled")).toEqual({ kind: "outcome", outcome: "cancelled" });
    expect(s("failed")).toEqual({ kind: "failed" });
    expect(s("expired")).toEqual({ kind: "failed" });
    expect(s("done", "rejected")).toEqual({ kind: "outcome", outcome: "rejected" });
    expect(s("done", "approved")).toEqual({ kind: "outcome", outcome: "done" });
    expect(s("done", null, "rejected")).toEqual({ kind: "outcome", outcome: "rejected" });
    expect(s("done")).toEqual({ kind: "outcome", outcome: "done" });
    expect(s("running")).toBeNull();
  });

  it("subFields: tiền tố sub_, chỉ vô hướng, bỏ khoá quá dài", () => {
    expect(subFields({ amount: 5, vendor: "A", ok: true, obj: {}, ["x".repeat(30)]: 1 })).toEqual({
      sub_amount: 5,
      sub_vendor: "A",
      sub_ok: "true",
    });
  });

  it("mappedValues: `<khoá>` = đầu vào lượt, `<bước>:<trường>` = output bước", () => {
    const p = { byStageKey: { pr: { total: 9 } }, inputs: { amount: "12" } };
    expect(mappedValues({ a: "amount", b: "pr:total", c: "pr:none", d: "missing" }, p)).toEqual({
      a: "12",
      b: "9",
    });
  });

  it("callIssue: vòng, tự gọi, sâu > 3, đúng 3", () => {
    const e = (pairs: [string, string[]][]) => new Map(pairs);
    expect(
      callIssue(
        "a",
        e([
          ["a", ["b"]],
          ["b", ["a"]],
        ]),
        3,
      )?.kind,
    ).toBe("cycle");
    expect(callIssue("a", e([["a", ["a"]]]), 3)?.kind).toBe("cycle");
    const chain = e([
      ["a", ["b"]],
      ["b", ["c"]],
      ["c", ["d"]],
      ["d", ["e"]],
    ]);
    expect(callIssue("a", chain, 3)?.kind).toBe("depth");
    expect(callIssue("b", chain, 3)).toBeNull();
  });
});
