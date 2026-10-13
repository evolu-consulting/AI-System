// HUB-FR-119 · HUB-FR-126 · ADM-FR-65 · P-c1 F2: form tự-sửa mã — def ⇄ draft, validate, luật chéo.
import { describe, expect, test } from "bun:test";
import {
  type AutofixDraft,
  type AutofixPart,
  autofixCrossErrors,
  autofixFieldErrors,
  autofixToDef,
  autofixToDraft,
  emptyAutofix,
  validateAutofixPart,
} from "./autofix-form";

const on = (p: Partial<AutofixDraft> = {}): AutofixDraft => ({
  ...emptyAutofix(),
  on: true,
  source: "repo",
  test: "bun test",
  ...p,
});
const stage = (p: Partial<AutofixPart> = {}): AutofixPart => ({
  name: "S",
  executor: "agent:a1",
  after: "review",
  autofix: on(),
  ...p,
});

describe("autofix-form", () => {
  test("toDef: tắt ⇒ null; bật ⇒ install rỗng = null, allow tách dòng", () => {
    expect(autofixToDef({ ...on(), on: false })).toBeNull();
    expect(autofixToDef(on({ allow: " src/** \n\n docs/*.md " }))).toEqual({
      source_key: "repo",
      install_cmd: null,
      test_cmd: "bun test",
      write_allowlist: ["src/**", "docs/*.md"],
    });
  });
  test("fromDef ⇄ toDef khứ hồi; null ⇒ tắt", () => {
    const def = {
      source_key: "repo",
      install_cmd: "bun install",
      test_cmd: "bun test",
      write_allowlist: ["src/**"],
    };
    expect(autofixToDef(autofixToDraft(def))).toEqual(def);
    expect(autofixToDraft(null).on).toBe(false);
  });
});

describe("autofix-form · validate", () => {
  test("validate ô: nguồn, test, install, allow", () => {
    expect(autofixFieldErrors(on(), 0)).toEqual({});
    expect(autofixFieldErrors(emptyAutofix(), 0)).toEqual({});
    const e = autofixFieldErrors(
      on({ source: "", test: " ", install: "x".repeat(1001), allow: "/abs\nok" }),
      2,
    );
    expect(Object.keys(e).sort()).toEqual([
      "stages.2.autofix.install_cmd",
      "stages.2.autofix.source_key",
      "stages.2.autofix.test_cmd",
      "stages.2.autofix.write_allowlist",
    ]);
    const many = Array.from({ length: 21 }, (_, i) => `d${i}/**`).join("\n");
    expect(Object.keys(autofixFieldErrors(on({ allow: many }), 0))).toEqual([
      "stages.0.autofix.write_allowlist",
    ]);
  });
  test("luật chéo: executor team, after auto, 2 stage tự-sửa", () => {
    const e = autofixCrossErrors([stage(), stage({ executor: "team:t1", after: "auto" })]);
    expect(e["stages.1.executor"]).toContain("AUTOFIX_EXECUTOR");
    expect(e["stages.1.after"]).toContain("AUTOFIX_REVIEW");
    expect(e["stages.1.autofix"]).toContain("AUTOFIX_MAX");
    expect(e["stages.0.autofix"]).toBeUndefined();
  });
  test("validateAutofixPart gộp ô + chéo; stage tắt không lỗi", () => {
    const e: Record<string, string> = {};
    validateAutofixPart([stage({ autofix: { ...on({ test: "" }), on: false } }), stage()], e);
    expect(e).toEqual({});
    validateAutofixPart([stage({ autofix: on({ test: "" }) })], e);
    expect(Object.keys(e)).toEqual(["stages.0.autofix.test_cmd"]);
  });
});
