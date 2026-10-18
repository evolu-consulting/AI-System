// HUB-FR-146 · D2-29 · plan-addendum A2: luật lưu def stage `tool` của domain (`tool-def.rules`) ≡ contract
// (`toolStageIssues` FE dùng) — cùng path + rule trên cùng bộ ca; `paramCompatible` ≡ ma trận plan-d2-rules §2.
import { describe, expect, it } from "bun:test";
import { toolStageIssues as contractIssues } from "@ai/contracts/hub-admin";
import {
  paramCompatible,
  type ToolStageShape,
  toolStageIssues,
} from "../../domain/defs/tool-def.rules";
import type { ArgSource } from "../../domain/tools/tool-run.rules";

type Rec = Record<string, unknown>;
type Draft = {
  key: string;
  step: number;
  real_action: boolean;
  executor: { kind: string; tool_key?: string; args?: Record<string, Rec> };
  output: { fields: { key: string; type: string; required: boolean }[] };
  answerer?: { kind: string };
  sources?: unknown[];
};
const PARAMS = [
  { name: "n", type: "number", required: true },
  { name: "s", type: "select", required: false, options: ["a", "b"] },
  { name: "t", type: "text", required: false },
];
const TOOLS_C = new Map([
  ["k", { key: "k", side_effect: false, params: PARAMS }],
  ["se", { key: "se", side_effect: true, params: PARAMS }],
]);
const TOOLS_D = new Map([
  ["k", { key: "k", sideEffect: false, params: PARAMS }],
  ["se", { key: "se", sideEffect: true, params: PARAMS }],
]);
const INPUTS = [
  { key: "so", type: "number" },
  { key: "ma", type: "text" },
];
const head: Draft = {
  key: "s0",
  step: 0,
  real_action: false,
  executor: { kind: "agent" },
  output: { fields: [{ key: "n", type: "number", required: true }] },
};
const tool = (args: Record<string, Rec>, key = "k", o: Partial<Draft> = {}): Draft => ({
  key: "s1",
  step: 1,
  real_action: false,
  executor: { kind: "tool", tool_key: key, args },
  output: { fields: [] },
  answerer: { kind: "starter" },
  ...o,
});
const argOf = (a: Rec): ArgSource =>
  a.from === "field"
    ? { from: "field", stageKey: a.stage_key as string, field: a.field as string }
    : (a as ArgSource);
const toDomain = (d: Draft): ToolStageShape => ({
  key: d.key,
  step: d.step,
  realAction: d.real_action,
  fields: d.output.fields,
  tool:
    d.executor.kind === "tool"
      ? {
          toolKey: d.executor.tool_key ?? "",
          args: Object.fromEntries(
            Object.entries(d.executor.args ?? {}).map(([k, v]) => [k, argOf(v)]),
          ),
        }
      : null,
  extras: {
    sources: d.sources?.length ?? 0,
    mustKnow: 0,
    autofix: false,
    answererKind: d.answerer?.kind ?? "starter",
  },
});

const CASES: Draft[][] = [
  [head, tool({ n: { from: "field", stage_key: "s0", field: "n" } })],
  [head, tool({ n: { from: "input", key: "so" }, s: { from: "const", value: "zz" } })],
  [head, tool({ n: { from: "input", key: "ma" }, x: { from: "const", value: 1 } })],
  [head, tool({ t: { from: "const", value: true } })],
  [head, tool({ n: { from: "const", value: 1 } }, "se")],
  [head, tool({ n: { from: "const", value: 1 } }, "k", { sources: [{}] })],
  [head, tool({ n: { from: "field", stage_key: "s0", field: "n" } }, "k", { step: 0 })],
  [head, tool({ n: { from: "const", value: 1 } }, "khong-co")],
];

describe("tool-def parity domain ≡ contract", () => {
  it("HUB-FR-146 · cùng issue (path + rule) trên 8 ca", () => {
    for (const stages of CASES) {
      const c = contractIssues(stages as never, INPUTS, TOOLS_C);
      const d: unknown[] = toolStageIssues(stages.map(toDomain), INPUTS, TOOLS_D);
      expect(d).toEqual(c);
    }
  });
  it("HUB-FR-146 · D2-29 · paramCompatible: number←string sai, text←boolean đúng, date←string đúng", () => {
    expect([
      paramCompatible("string", "number"),
      paramCompatible("boolean", "text"),
      paramCompatible("string", "date"),
      paramCompatible("number", "select"),
    ]).toEqual([false, true, true, false]);
  });
});
