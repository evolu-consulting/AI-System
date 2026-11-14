// fix-review-r1 · «Bắt đầu khi» đã lưu: đúng dạng ⇒ giữ; sai dạng ⇒ null + cờ (không ép kiểu, không đọc thành «mọi hợp đồng»).
import { describe, expect, it } from "bun:test";
import type { FactWhen } from "@ai/contracts/hub-admin";
import { readStartWhen } from "./approval-flow.usecase";

describe("readStartWhen [fix-review-r1]", () => {
  it("vắng ⇒ null, không cờ (mọi hợp đồng còn lại)", () => {
    expect(readStartWhen(undefined)).toEqual({ start_when: null });
    expect(readStartWhen(null)).toEqual({ start_when: null });
  });
  it("đúng dạng ⇒ giữ nguyên", () => {
    const w: FactWhen = { op: "and", conds: [{ fact: "total_value", op: "ge", value: 5e8 }] };
    expect(readStartWhen(w)).toEqual({ start_when: w });
  });
  it("sai dạng ⇒ null + cờ start_when_unreadable", () => {
    for (const bad of [{ op: "xor", conds: [] }, "abc", { conds: 5 }, 42, { op: "and" }]) {
      expect(readStartWhen(bad)).toEqual({ start_when: null, start_when_unreadable: true });
    }
  });
});
