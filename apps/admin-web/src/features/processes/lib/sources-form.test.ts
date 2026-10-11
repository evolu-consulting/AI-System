// ADM-FR-69 · HUB-FR-124/125 · P-b FS-6: test hàm thuần của form nguồn / đầu vào / must_know.
import { describe, expect, test } from "bun:test";
import { type DefDraft, emptyDraft, emptyStage, toDraft, toInput, validateDraft } from "./def-form";
import { pathErrorKey } from "./errors";
import {
  canDropSource,
  emptyInput,
  firstStageUsing,
  inputsToDef,
  inputsToDraft,
  mustKnowToDef,
  stageSourcesToDef,
  stageSourcesToDraft,
  unusedSources,
  validateSourcesPart,
} from "./sources-form";

const A = "11111111-1111-4111-8111-111111111111";

function valid(): DefDraft {
  const d = emptyDraft();
  Object.assign(d, { key: "ql", name: "Quy trình" });
  Object.assign(d.stages[0] ?? emptyStage(), {
    key: "doc",
    name: "Đọc",
    executor: `agent:${A}`,
    filename: "doc.md",
    template: "# Doc",
    sections: ["Tóm tắt"],
  });
  return d;
}

describe("allowlist ⇄ textarea, must_know", () => {
  test("round-trip, bỏ dòng trống và khoảng trắng", () => {
    const d = stageSourcesToDraft([{ source_key: "repo", allowlist: ["docs/**", "a.md"] }]);
    expect(d[0]?.allowlist).toBe("docs/**\na.md");
    expect(stageSourcesToDef([{ key: "repo", allowlist: " docs/** \n\r\n\n a.md " }])).toEqual([
      { source_key: "repo", allowlist: ["docs/**", "a.md"] },
    ]);
    expect(mustKnowToDef("a\n\n b \n")).toEqual(["a", "b"]);
  });
});

describe("inputs", () => {
  test("options chỉ đi kèm select", () => {
    const rows = [
      { ...emptyInput(), key: "ten", label: "Tên", type: "text" as const, options: "x" },
      { ...emptyInput(), key: "loai", label: "Loại", type: "select" as const, options: "a\nb" },
    ];
    const out = inputsToDef(rows);
    expect(out[0]).toEqual({ key: "ten", label: "Tên", type: "text", required: false });
    expect(out[1]?.options).toEqual(["a", "b"]);
    expect(inputsToDraft(out)[1]?.options).toBe("a\nb");
  });
  test("validate: khoá sai/trùng, nhãn trống, select không lựa chọn / trùng", () => {
    const d = valid();
    d.inputs = [
      { ...emptyInput(), key: "A", label: "x" },
      { ...emptyInput(), key: "ok", label: "" },
      { ...emptyInput(), key: "ok", label: "y", type: "select", options: "" },
      { ...emptyInput(), key: "sel", label: "y", type: "select", options: "a\na" },
    ];
    const e: Record<string, string> = {};
    validateSourcesPart(d, e);
    expect(Object.keys(e).sort()).toEqual([
      "inputs.0.key",
      "inputs.1.label",
      "inputs.2.key",
      "inputs.2.options",
      "inputs.3.options",
    ]);
  });
  test("tối đa 10 trường", () => {
    const d = valid();
    d.inputs = Array.from({ length: 11 }, (_, i) => ({
      ...emptyInput(),
      key: `k${i}x`,
      label: "l",
    }));
    expect(validateDraft(d).inputs).toBe("process.admin.editor.err.input.max");
  });
});

describe("nguồn dùng / bỏ", () => {
  const def = {
    sources: ["repo", "doc", "idle"],
    stages: [
      { sources: [], mustKnow: "" },
      { sources: [{ key: "doc", allowlist: "" }], mustKnow: "" },
    ],
  };
  test("unusedSources / firstStageUsing / canDropSource", () => {
    expect(unusedSources(def)).toEqual(["repo", "idle"]);
    expect(firstStageUsing(def, "doc")).toBe(2);
    expect(canDropSource(def, "doc")).toBe(false);
    expect(canDropSource(def, "idle")).toBe(true);
  });
});

describe("validate giai đoạn", () => {
  test("nguồn ngoài danh sách, glob xấu, quá 20 mẫu, must_know", () => {
    const d = valid();
    d.sources = ["repo"];
    const s = d.stages[0] as DefDraft["stages"][number];
    s.sources = [
      { key: "lạ", allowlist: "" },
      { key: "repo", allowlist: "../x" },
    ];
    s.mustKnow = Array.from({ length: 11 }, (_, i) => `m${i}`).join("\n");
    const e = validateDraft(d);
    expect(e["stages.0.sources.0.source_key"]).toBe("process.admin.editor.stageSources.notInDef");
    expect(e["stages.0.sources.1.allowlist"]).toBe("process.admin.editor.err.glob.invalid");
    expect(e["stages.0.must_know"]).toBe("process.admin.editor.err.mustKnow.max");
    s.sources = [
      { key: "repo", allowlist: Array.from({ length: 21 }, (_, i) => `a${i}`).join("\n") },
    ];
    s.mustKnow = "x".repeat(201);
    const e2 = validateDraft(d);
    expect(e2["stages.0.sources.0.allowlist"]).toBe("process.admin.editor.err.glob.max");
    expect(e2["stages.0.must_know"]).toBe("process.admin.editor.err.mustKnow.tooLong");
  });
  test("hợp lệ ⇒ không lỗi nguồn", () => {
    const d = valid();
    d.sources = ["repo"];
    (d.stages[0] as DefDraft["stages"][number]).sources = [{ key: "repo", allowlist: "docs/**" }];
    expect(validateDraft(d)).toEqual({});
  });
});

describe("toInput giữ nguồn / đầu vào (không xoá khi lưu từ builder)", () => {
  test("toDraft → toInput round-trip", () => {
    const d = valid();
    d.sources = ["repo"];
    d.inputs = [{ ...emptyInput(), key: "loai", label: "Loại", type: "select", options: "a\nb" }];
    const s = d.stages[0] as DefDraft["stages"][number];
    s.sources = [{ key: "repo", allowlist: "docs/**" }];
    s.mustKnow = "Ai duyệt?";
    const body = toInput(d);
    expect(body.sources).toEqual(["repo"]);
    expect(body.inputs).toEqual([
      { key: "loai", label: "Loại", type: "select", required: false, options: ["a", "b"] },
    ]);
    expect(body.stages[0]?.sources).toEqual([{ source_key: "repo", allowlist: ["docs/**"] }]);
    expect(body.stages[0]?.must_know).toEqual(["Ai duyệt?"]);
    const again = toInput(toDraft(body));
    expect(again.sources).toEqual(body.sources);
    expect(again.inputs).toEqual(body.inputs);
    expect(again.stages[0]?.sources).toEqual(body.stages[0]?.sources);
  });
});

describe("pathErrorKey", () => {
  test("PROCESS_REF_INVALID ở nguồn giai đoạn có câu riêng", () => {
    expect(pathErrorKey("PROCESS_REF_INVALID", "stages.2.sources.0.source_key")).toBe(
      "process.admin.editor.stageSources.notInDef",
    );
    expect(pathErrorKey("PROCESS_REF_INVALID", "stages.2.executor")).toBe(
      "process.admin.apiError.PROCESS_REF_INVALID",
    );
  });
});
