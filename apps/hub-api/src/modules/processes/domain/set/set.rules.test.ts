// CR-103 · R4 · luật thuần node `set`.
import { describe, expect, test } from "bun:test";
import { SetExecutorSchema } from "@ai/contracts/hub-admin";
import { type SetStageShape, setDefIssues, setFields } from "./set.rules";

const fields = [
  { key: "amount", type: "number" },
  { key: "purpose", type: "string" },
];
const exec = {
  kind: "set" as const,
  values: [
    { key: "amount", from: { input: "amount" } },
    { key: "purpose", from: { input: "purpose" } },
    { key: "unit", from: { const: "VND" } },
  ],
};

describe("setFields", () => {
  test.each([
    [
      { amount: "150000000", purpose: "mua sắm" },
      { amount: 150000000, purpose: "mua sắm", unit: "VND" },
    ],
    [
      { amount: "abc", purpose: "x" },
      { purpose: "x", unit: "VND" },
    ],
    [{ purpose: "x" }, { purpose: "x", unit: "VND" }],
  ])("inputs %j", (inputs, want) => {
    expect(setFields(exec, inputs, fields)).toEqual(want);
  });
});

const stage = (values: unknown, f = fields): SetStageShape => ({
  executor: { kind: "set", values: values as never },
  fields: f,
});
const inputs = [
  { key: "amount", type: "number" },
  { key: "purpose", type: "text" },
  { key: "doc", type: "file" },
];

describe("setDefIssues", () => {
  test.each([
    ["hợp lệ", [{ key: "amount", from: { input: "amount" } }], []],
    ["key chưa khai", [{ key: "zzz", from: { const: "a" } }], ["stages.0.executor.values.0.key"]],
    [
      "key trùng",
      [
        { key: "purpose", from: { const: "a" } },
        { key: "purpose", from: { const: "b" } },
      ],
      ["stages.0.executor.values.1.key"],
    ],
    [
      "input không có",
      [{ key: "amount", from: { input: "nope" } }],
      ["stages.0.executor.values.0.from"],
    ],
    [
      "lệch kiểu input",
      [{ key: "purpose", from: { input: "amount" } }],
      ["stages.0.executor.values.0.from"],
    ],
    [
      "input file",
      [{ key: "purpose", from: { input: "doc" } }],
      ["stages.0.executor.values.0.from"],
    ],
    [
      "hằng lệch kiểu",
      [{ key: "amount", from: { const: "x" } }],
      ["stages.0.executor.values.0.from"],
    ],
  ])("%s", (_n, values, paths) => {
    expect(setDefIssues([stage(values)], inputs).map((i) => i.path)).toEqual(paths);
  });
});

test("SetExecutorSchema: > 20 dòng bị từ chối", () => {
  const v = { key: "a", from: { const: 1 } };
  expect(SetExecutorSchema.safeParse({ kind: "set", values: [v] }).success).toBe(true);
  expect(SetExecutorSchema.safeParse({ kind: "set", values: Array(21).fill(v) }).success).toBe(
    false,
  );
});
