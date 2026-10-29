// CR-103 · R4 · logic thuần trang showcase.
import { describe, expect, test } from "bun:test";
import type { ProcessInputDef } from "@ai/contracts/hub-admin";
import { inputIssues, swappable, toInputValues } from "./showcase";

const defs: ProcessInputDef[] = [
  { key: "amount", label: "Số tiền", type: "number", required: true },
  { key: "purpose", label: "Mục đích", type: "text", required: true },
  { key: "note", label: "Ghi chú", type: "text", required: false },
];

describe("inputIssues", () => {
  test.each([
    [{ amount: "150000000", purpose: "mua sắm" }, {}],
    [{ amount: "", purpose: "x" }, { amount: "required" }],
    [
      { amount: "abc", purpose: "" },
      { amount: "number", purpose: "required" },
    ],
  ])("%j", (raw, want) => expect(inputIssues(defs, raw)).toEqual(want as never));
});

test("toInputValues: ép đúng kiểu, bỏ ô rỗng", () => {
  expect(toInputValues(defs, { amount: " 50000000 ", purpose: "mua sắm", note: "" })).toEqual([
    { type: "number", key: "amount", value: "50000000" },
    { type: "text", key: "purpose", text: "mua sắm" },
  ]);
});

test("swappable: chỉ họ work có nhiều loại", () => {
  expect([swappable("work"), swappable("wait"), swappable("control")]).toEqual([
    true,
    false,
    false,
  ]);
});
