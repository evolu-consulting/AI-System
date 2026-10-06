import { describe, expect, test } from "bun:test";
import type { WorkflowInput } from "@ai/contracts";
import {
  changedWorkflowFields,
  checkSchemaChange,
  checkWorkflowDelete,
  checkWorkflowDisable,
  inputMapGaps,
  isUnattached,
} from "./workflows.rules";

const p = (name: string, required: boolean): WorkflowInput => ({
  name,
  type: "text",
  required,
  description: "d",
});

describe("ADM-FR-13 · workflows.rules", () => {
  test("ADM-FR-14 · isUnattached", () => {
    expect(isUnattached({ commandCount: 0, agentCount: 0 })).toBe(true);
    expect(isUnattached({ commandCount: 0, agentCount: 1 })).toBe(false);
  });

  test("ADM-FR-13 · xoá chặn cả command tắt; tắt chỉ chặn command bật/agent", () => {
    const off = { id: "c", name: "x", enabled: false };
    expect(checkWorkflowDelete({ commands: [off], agents: [] })?.code).toBe("WORKFLOW_IN_USE");
    expect(checkWorkflowDisable({ commands: [off], agents: [] })).toBeNull();
  });

  test("ADM-FR-22 · gaps + schema change", () => {
    const schema = [p("a", true), p("b", false)];
    expect(inputMapGaps(schema, { z: { source: "selection" } })).toEqual({
      missing: ["a"],
      unknown: ["z"],
    });
    expect(
      checkSchemaChange(schema, [{ id: "c", name: "n", inputMap: { a: { source: "selection" } } }]),
    ).toBeNull();
  });

  test("ADM-FR-10 · changedWorkflowFields so sâu", () => {
    const s = {
      name: "n",
      description: "d",
      appType: "chat",
      baseUrl: "https://x",
      secretId: "s",
      inputSchema: [p("a", true)],
      outputField: null,
      enabled: true,
      sideEffect: false,
    };
    expect(changedWorkflowFields(s, { ...s, inputSchema: [p("a", true)] })).toEqual([]);
    expect(changedWorkflowFields(s, { ...s, enabled: false })).toEqual(["enabled"]);
    expect(changedWorkflowFields(s, { ...s, sideEffect: true })).toEqual(["sideEffect"]);
  });
});
