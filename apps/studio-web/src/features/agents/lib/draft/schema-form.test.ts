// HUB-FR-61 · H4a-D9, R04, R05 · SchemaForm (dựng trường, ghi giá trị), cảnh báo codex/gemini, runtimeMissing, lọc picker.
import { describe, expect, test } from "bun:test";
import type { WorkflowItem } from "../../hooks/use-editor-catalogs";
import { appTypesOf, cliNotReady, filterWorkflows, runtimeMissing } from "../runtime-notice";
import { fieldOfPath } from "./draft";
import { buildFields, getAt, parseJson, parseNum, setAt } from "./schema-form";

describe("buildFields", () => {
  const schema = {
    type: "object",
    required: ["url"],
    properties: {
      url: { type: "string" },
      retries: { type: "integer" },
      ratio: { type: "number" },
      verbose: { type: "boolean" },
      mode: { enum: ["fast", "slow"] },
      auth: { type: "object", properties: { user: { type: "string" }, deep: { type: "object" } } },
      tags: { type: "array" },
    },
  };
  test("ánh xạ kiểu, required, enum, object 1 cấp, kiểu khác thành json", () => {
    const f = buildFields(schema);
    expect(f.map((x) => [x.name, x.kind])).toEqual([
      ["url", "string"],
      ["retries", "integer"],
      ["ratio", "number"],
      ["verbose", "boolean"],
      ["mode", "enum"],
      ["auth", "object"],
      ["tags", "json"],
    ]);
    expect(f[0]?.required).toBe(true);
    expect(f[4]?.options).toEqual(["fast", "slow"]);
    expect(f[5]?.children.map((c) => [c.name, c.kind])).toEqual([
      ["user", "string"],
      ["deep", "json"],
    ]);
  });
  test("schema không có properties thì rỗng", () => {
    expect(buildFields({})).toEqual([]);
  });
});

describe("setAt / getAt / parse", () => {
  test("ghi lồng nhau, xoá khóa, bỏ object rỗng, không đổi bản gốc", () => {
    const a = { x: 1 };
    const b = setAt(a, ["auth", "user"], "u");
    expect(b).toEqual({ x: 1, auth: { user: "u" } });
    expect(a).toEqual({ x: 1 });
    expect(getAt(b, ["auth", "user"])).toBe("u");
    expect(setAt(b, ["auth", "user"], undefined)).toEqual({ x: 1 });
    expect(setAt(b, ["x"], undefined)).toEqual({ auth: { user: "u" } });
  });
  test("parseNum", () => {
    expect(parseNum("", true)).toBeUndefined();
    expect(parseNum("3", true)).toBe(3);
    expect(parseNum("3.5", true)).toBeNull();
    expect(parseNum("3.5", false)).toBe(3.5);
    expect(parseNum("abc", false)).toBeNull();
  });
  test("parseJson", () => {
    expect(parseJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseJson("{")).toEqual({ ok: false });
    expect(parseJson("  ")).toEqual({ ok: true, value: undefined });
  });
});

describe("max_turns", () => {
  test("path runtime_options.max_turns gắn đúng trường", () => {
    expect(fieldOfPath(["runtime_options", "max_turns"])).toBe("max_turns");
  });
});

describe("cảnh báo và lọc", () => {
  test("cliNotReady: chỉ codex/gemini", () => {
    expect(cliNotReady("claude")).toBe(false);
    expect(cliNotReady("codex")).toBe(true);
    expect(cliNotReady("gemini")).toBe(true);
  });
  test("runtimeMissing: chỉ khi đã tải, runtime cần Worker và không có loại available", () => {
    const types = [
      { runtime: "python", available: true },
      { runtime: "llm", available: false },
    ];
    expect(runtimeMissing("python", types, true)).toBe(false);
    expect(runtimeMissing("llm", types, true)).toBe(true);
    expect(runtimeMissing("agentic-cli", types, true)).toBe(true);
    expect(runtimeMissing("agentic-cli", types, false)).toBe(false);
    expect(runtimeMissing("dify-workflow", [], true)).toBe(false);
  });
  const w = (key: string, app_type: string): WorkflowItem => ({
    id: key,
    key,
    name: `Tên ${key}`,
    description: null,
    app_type,
    usable_for: ["tool"],
  });
  test("filterWorkflows theo loại và chuỗi", () => {
    const items = [w("a-one", "workflow"), w("b-two", "agent"), w("a-three", "agent")];
    expect(appTypesOf(items)).toEqual(["agent", "workflow"]);
    expect(filterWorkflows(items, "", "").length).toBe(3);
    expect(filterWorkflows(items, "A-", "agent").map((x) => x.key)).toEqual(["a-three"]);
  });
});
