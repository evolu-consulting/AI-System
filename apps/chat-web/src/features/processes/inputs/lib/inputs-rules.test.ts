// HUB-FR-124 · AC-H37 · unit luật thuần của form `!key`.
import { describe, expect, test } from "bun:test";
import type { ProcessInputDef, ProcessSourceChip } from "@ai/contracts/hub-admin";
import {
  emptyValues,
  fieldErrors,
  gitChips,
  needsForm,
  submitErrorKey,
  toRequestInputs,
  validateSourceRef,
} from "./inputs-rules";

const defs: ProcessInputDef[] = [
  { key: "brief", label: "Yêu cầu", type: "text", required: true },
  { key: "tier", label: "Gói", type: "select", required: false, options: ["a", "b"] },
  { key: "doc", label: "Tài liệu", type: "file", required: false },
  { key: "repo", label: "Kho mã", type: "source_ref", required: false },
];

describe("needsForm", () => {
  test("chỉ khi có inputs", () => {
    expect(needsForm({})).toBe(false);
    expect(needsForm({ inputs: [] })).toBe(false);
    expect(needsForm({ inputs: defs })).toBe(true);
  });
});

describe("toRequestInputs", () => {
  test("form trống ⇒ []", () => {
    expect(toRequestInputs(defs, emptyValues(defs))).toEqual([]);
  });
  test("ghép type, bỏ rỗng", () => {
    const v = emptyValues(defs);
    v.brief = { value: "  làm đi ", fileName: "", branch: "" };
    v.tier = { value: "b", fileName: "", branch: "" };
    v.doc = { value: "11111111-1111-4111-8111-111111111111", fileName: "a.md", branch: "" };
    v.repo = { value: "web", fileName: "", branch: " main " };
    expect(toRequestInputs(defs, v)).toEqual([
      { type: "text", key: "brief", text: "làm đi" },
      { type: "select", key: "tier", value: "b" },
      { type: "file", key: "doc", attachment_id: "11111111-1111-4111-8111-111111111111" },
      { type: "source_ref", key: "repo", source_key: "web", branch: "main" },
    ]);
  });
  test("source_ref thiếu nhánh ⇒ bỏ", () => {
    const v = emptyValues(defs);
    v.repo = { value: "web", fileName: "", branch: "" };
    expect(toRequestInputs(defs, v)).toEqual([]);
  });
});

describe("validateSourceRef", () => {
  test("chưa chọn nguồn ⇒ hợp lệ", () => expect(validateSourceRef("", "")).toBeNull());
  test("thiếu nhánh", () => expect(validateSourceRef("web", "  ")).toBe("required"));
  test("nhánh bắt đầu '-'", () => expect(validateSourceRef("web", "-x")).toBe("dash"));
  test("quá dài", () => expect(validateSourceRef("web", "a".repeat(256))).toBe("tooLong"));
  test("hợp lệ", () => expect(validateSourceRef("web", "main")).toBeNull());
});

describe("fieldErrors", () => {
  test("gom lỗi theo khoá", () => {
    const v = emptyValues(defs);
    v.repo = { value: "web", fileName: "", branch: "" };
    expect(fieldErrors(defs, v)).toEqual({ repo: "required" });
  });
});

describe("gitChips", () => {
  test("lọc git_remote", () => {
    const chips: ProcessSourceChip[] = [
      { key: "web", kind: "git_remote", description: "d", default_branch: "main" },
      { key: "doc", kind: "library", description: "d" },
    ];
    expect(gitChips(chips).map((c) => c.key)).toEqual(["web"]);
  });
});

describe("submitErrorKey", () => {
  test("map mã lỗi", () => {
    expect(submitErrorKey("SOURCE_UNRESOLVABLE", "k", 5).key).toBe(
      "process.inputs.err.sourceUnresolvable",
    );
    expect(submitErrorKey("VALIDATION_ERROR", "k", 5).key).toBe("process.inputs.err.sourceInvalid");
    expect(submitErrorKey("PROCESS_NOT_FOUND", "abc", 5)).toEqual({
      key: "process.composer.error.notFound",
      params: { key: "abc" },
    });
    expect(submitErrorKey("TOO_MANY_PROCESS_RUNS", "k", 5).params).toEqual({ max: 5 });
    expect(submitErrorKey("X", "k", 5).key).toBe("process.inputs.err.generic");
  });
});
