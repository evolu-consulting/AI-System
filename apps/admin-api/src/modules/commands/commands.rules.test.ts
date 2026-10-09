import { describe, expect, test } from "bun:test";
import type { WorkflowInput } from "@ai/contracts";
import {
  changedCommandFields,
  checkCommandEnable,
  checkInputMap,
  commandNames,
  defaultTimeout,
  inputMapError,
  inputMapWarnings,
} from "./commands.rules";

const p = (name: string, type: WorkflowInput["type"], required = false): WorkflowInput => ({
  name,
  type,
  required,
  description: "d",
});

describe("ADM-FR-22 · commands.rules", () => {
  test("ADM-BR-01 · tên + timeout", () => {
    expect(commandNames({ name: "a", aliases: ["b"] })).toEqual(["a", "b"]);
    expect(defaultTimeout("async")).toBe(120);
  });

  test("ADM-FR-22 · AC-A03 · checkInputMap + inputMapError", () => {
    const c = checkInputMap([p("x", "text", true)], [], { y: { source: "arg", value: "z" } });
    expect(c).toEqual({ missing: ["x"], unknown: ["y"], unknown_args: ["z"] });
    expect(inputMapError(c)?.code).toBe("INPUT_MAP_INVALID");
    expect(inputMapError({ missing: [], unknown: [], unknown_args: [] })).toBeNull();
  });

  test("ADM-FR-22 · cảnh báo: type_mismatch ưu tiên hơn const_invalid; arg không cảnh báo", () => {
    const s = [p("f", "file"), p("n", "number")];
    expect(
      inputMapWarnings(s, {
        f: { source: "const", value: "x" },
        n: { source: "const", value: "1" },
      }),
    ).toEqual([{ var: "f", type: "file", source: "const", reason: "type_mismatch" }]);
    expect(inputMapWarnings(s, { n: { source: "arg", value: "a" } })).toEqual([]);
  });

  test("ADM-BR-02 · enable", () => {
    expect(checkCommandEnable(true, { id: "w", key: "k", enabled: false })?.code).toBe(
      "WORKFLOW_DISABLED",
    );
  });

  test("ADM-FR-20 · changedCommandFields: featureIds như tập, aliases theo thứ tự", () => {
    const s = {
      name: "a",
      aliases: ["x", "y"],
      description: { vi: "d" },
      workflowId: "w",
      args: [],
      inputMap: {},
      output: { field: "t", render: "text" },
      mode: "sync" as const,
      timeoutS: 30,
      enabled: true,
      featureIds: ["1", "2"],
    };
    expect(changedCommandFields(s, { ...s, featureIds: ["2", "1"] })).toEqual([]);
    expect(changedCommandFields(s, { ...s, aliases: ["y", "x"] })).toEqual(["aliases"]);
  });
});
