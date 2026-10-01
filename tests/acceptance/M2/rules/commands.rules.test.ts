// ADM-FR-20, ADM-FR-21, ADM-FR-22, ADM-BR-01, ADM-BR-02, ADM-BR-06, ADM-BR-10 · luật thuần commands
// (plan.md §4 `commands.rules.ts`; M2-R13…R19). Không DB.
import { describe, expect, it } from "bun:test";
import { loadCommandsRules } from "../_modules";

const inp = (name: string, type: string, required = false, options?: string[]) => ({
  name,
  type,
  required,
  description: `Tham số ${name}`,
  ...(options ? { options } : {}),
});
const SCHEMA = [
  inp("source_text", "text", true),
  inp("target_lang", "text", true),
  inp("tone", "select", false, ["formal", "casual"]),
];
const arg = (name: string) => ({
  name,
  description: { vi: name },
  default: null,
  fallback: null,
  rest: false,
});
const ARGS = [arg("lang"), arg("text")];
const FULL = {
  source_text: { source: "arg", value: "text" },
  target_lang: { source: "arg", value: "lang" },
};

describe("ADM-BR-01 · commandNames / defaultTimeout", () => {
  it("ADM-BR-01 · M2-R13 · commandNames = [name, ...aliases]", async () => {
    const r = await loadCommandsRules();
    expect(r.commandNames({ name: "dich", aliases: ["tr", "d2"] })).toEqual(["dich", "tr", "d2"]);
    expect(r.commandNames({ name: "dich", aliases: [] })).toEqual(["dich"]);
  });

  it("ADM-FR-20 · M2-R15 · defaultTimeout: sync 30, async 120", async () => {
    const r = await loadCommandsRules();
    expect(r.defaultTimeout("sync")).toBe(30);
    expect(r.defaultTimeout("async")).toBe(120);
  });
});

describe("ADM-FR-22 · checkInputMap / inputMapError (M2-R17)", () => {
  it("ADM-FR-22 · AC-A03 · map đủ → ba mảng rỗng; thiếu target_lang → missing [target_lang]", async () => {
    const r = await loadCommandsRules();
    expect(r.checkInputMap(SCHEMA, ARGS, FULL)).toEqual({
      missing: [],
      unknown: [],
      unknown_args: [],
    });
    expect(r.checkInputMap(SCHEMA, ARGS, { source_text: FULL.source_text })).toEqual({
      missing: ["target_lang"],
      unknown: [],
      unknown_args: [],
    });
  });

  it("ADM-FR-22 · M2-R17 · khoá không có trong workflow → unknown; arg trỏ tham số chưa khai báo → unknown_args", async () => {
    const r = await loadCommandsRules();
    const map = { ...FULL, foo: { source: "selection" } };
    expect(r.checkInputMap(SCHEMA, ARGS, map).unknown).toEqual(["foo"]);
    const bad = { ...FULL, target_lang: { source: "arg", value: "language" } };
    expect(r.checkInputMap(SCHEMA, ARGS, bad)).toEqual({
      missing: [],
      unknown: [],
      unknown_args: ["language"],
    });
  });

  it("ADM-FR-22 · M2-R17 · unknown_args không trùng lặp, theo thứ tự khoá map; const không bị kiểm", async () => {
    const r = await loadCommandsRules();
    const map = {
      source_text: { source: "arg", value: "zz" },
      target_lang: { source: "arg", value: "zz" },
      tone: { source: "const", value: "zz" },
    };
    expect(r.checkInputMap(SCHEMA, ARGS, map).unknown_args).toEqual(["zz"]);
  });

  it("ADM-FR-22 · M2-R17 · nhiều lỗi cùng lúc → đủ ba mảng; input không bắt buộc (tone) thiếu thì ổn", async () => {
    const r = await loadCommandsRules();
    const map = { foo: { source: "arg", value: "nope" } };
    expect(r.checkInputMap(SCHEMA, ARGS, map)).toEqual({
      missing: ["source_text", "target_lang"],
      unknown: ["foo"],
      unknown_args: ["nope"],
    });
    expect(r.checkInputMap(SCHEMA, ARGS, FULL).missing).not.toContain("tone");
  });

  it("ADM-FR-22 · M2-R17 · inputMapError: ba mảng rỗng → null; mỗi mảng riêng ≠ rỗng → INPUT_MAP_INVALID đủ 3 khoá", async () => {
    const r = await loadCommandsRules();
    const none = { missing: [], unknown: [], unknown_args: [] };
    expect(r.inputMapError(none)).toBeNull();
    for (const k of ["missing", "unknown", "unknown_args"]) {
      const c = { ...none, [k]: ["x"] };
      expect(r.inputMapError(c)).toEqual({ code: "INPUT_MAP_INVALID", details: c });
    }
  });
});

describe("ADM-FR-22 · inputMapWarnings (M2-R17: map sai kiểu chỉ cảnh báo)", () => {
  const S = [
    inp("f", "file"),
    inp("t", "text"),
    inp("n", "number"),
    inp("b", "boolean"),
    inp("s", "select", false, ["formal", "casual"]),
  ];
  const warn = (map: Record<string, unknown>) => {
    return loadCommandsRules().then((r) => r.inputMapWarnings(S, map));
  };
  const w = (v: string, type: string, source: string, reason: string) => ({
    var: v,
    type,
    source,
    reason,
  });

  it("ADM-FR-22 · M2-R17 · file ← nguồn khác attachment → type_mismatch (trừ arg); file ← attachment → không", async () => {
    expect(await warn({ f: { source: "selection" } })).toEqual([
      w("f", "file", "selection", "type_mismatch"),
    ]);
    expect(await warn({ f: { source: "page_text" } })).toEqual([
      w("f", "file", "page_text", "type_mismatch"),
    ]);
    expect(await warn({ f: { source: "const", value: "x" } })).toEqual([
      w("f", "file", "const", "type_mismatch"),
    ]);
    expect(await warn({ f: { source: "arg", value: "x" } })).toEqual([]);
    expect(await warn({ f: { source: "attachment" } })).toEqual([]);
  });

  it("ADM-FR-22 · M2-R17 · attachment → input không phải file → type_mismatch", async () => {
    expect(await warn({ t: { source: "attachment" } })).toEqual([
      w("t", "text", "attachment", "type_mismatch"),
    ]);
    expect(await warn({ n: { source: "attachment" } })).toEqual([
      w("n", "number", "attachment", "type_mismatch"),
    ]);
  });

  it("ADM-FR-22 · M2-R17 · number/boolean/select ← nguồn văn bản (selection, page_url, page_text, user_id, tenant_id) → type_mismatch", async () => {
    for (const src of ["selection", "page_url", "page_text", "user_id", "tenant_id"]) {
      expect(await warn({ n: { source: src } })).toEqual([w("n", "number", src, "type_mismatch")]);
      expect(await warn({ b: { source: src } })).toEqual([w("b", "boolean", src, "type_mismatch")]);
      expect(await warn({ s: { source: src } })).toEqual([w("s", "select", src, "type_mismatch")]);
    }
  });

  it("ADM-FR-22 · M2-R17 · text ← selection/page_url/user_id/const bất kỳ → không cảnh báo; arg không bao giờ cảnh báo", async () => {
    for (const src of ["selection", "page_url", "page_text", "user_id", "tenant_id"]) {
      expect(await warn({ t: { source: src } })).toEqual([]);
    }
    expect(await warn({ t: { source: "const", value: "bất kỳ" } })).toEqual([]);
    for (const k of ["f", "t", "n", "b", "s"]) {
      expect(await warn({ [k]: { source: "arg", value: "x" } })).toEqual([]);
    }
  });

  it("ADM-FR-22 · M2-R17 · number ← const: '', ' ', 'abc', 'Infinity' → const_invalid; '3', '1e3', '-2.5' → không", async () => {
    for (const v of ["", " ", "abc", "Infinity"]) {
      expect(await warn({ n: { source: "const", value: v } })).toEqual([
        w("n", "number", "const", "const_invalid"),
      ]);
    }
    for (const v of ["3", "1e3", "-2.5"]) {
      expect(await warn({ n: { source: "const", value: v } })).toEqual([]);
    }
  });

  it("ADM-FR-22 · M2-R17 · boolean ← const: 'True', '1' → const_invalid; 'true', 'false' → không", async () => {
    for (const v of ["True", "1"]) {
      expect(await warn({ b: { source: "const", value: v } })).toEqual([
        w("b", "boolean", "const", "const_invalid"),
      ]);
    }
    for (const v of ["true", "false"])
      expect(await warn({ b: { source: "const", value: v } })).toEqual([]);
  });

  it("ADM-FR-22 · M2-R17 · select ← const ngoài options → const_invalid; trong options → không", async () => {
    expect(await warn({ s: { source: "const", value: "polite" } })).toEqual([
      w("s", "select", "const", "const_invalid"),
    ]);
    expect(await warn({ s: { source: "const", value: "formal" } })).toEqual([]);
  });

  it("ADM-FR-22 · M2-R17 · khoá không có trong schema → không cảnh báo; kết quả theo thứ tự schema", async () => {
    expect(await warn({ ghost: { source: "attachment" } })).toEqual([]);
    const out = await warn({ s: { source: "selection" }, f: { source: "selection" } });
    expect(out.map((x: { var: string }) => x.var)).toEqual(["f", "s"]);
  });
});

describe("ADM-BR-10 · checkCommandFeatures / checkCommandEnable (M2-R14, M2-R19)", () => {
  it("ADM-BR-10 · M2-R19 · checkCommandFeatures: [] → COMMAND_NEEDS_FEATURE không details; có phần tử → null", async () => {
    const r = await loadCommandsRules();
    const err = r.checkCommandFeatures([]);
    expect(err).toMatchObject({ code: "COMMAND_NEEDS_FEATURE" });
    expect(err.details).toBeUndefined();
    expect(r.checkCommandFeatures(["f1"])).toBeNull();
  });

  it("ADM-BR-02 · M2-R14 · checkCommandEnable: bật + workflow tắt → WORKFLOW_DISABLED {workflow:{id,key}}; còn lại null", async () => {
    const r = await loadCommandsRules();
    const off = { id: "w1", key: "translate", enabled: false };
    const on = { id: "w1", key: "translate", enabled: true };
    expect(r.checkCommandEnable(true, off)).toEqual({
      code: "WORKFLOW_DISABLED",
      details: { workflow: { id: "w1", key: "translate" } },
    });
    expect(r.checkCommandEnable(false, off)).toBeNull();
    expect(r.checkCommandEnable(true, on)).toBeNull();
    expect(r.checkCommandEnable(false, on)).toBeNull();
  });
});

describe("ADM-FR-20 · changedCommandFields (M2-R25)", () => {
  const cur = {
    name: "dich",
    aliases: ["tr", "d2"],
    description: { vi: "Dịch" },
    workflowId: "w1",
    args: ARGS,
    inputMap: FULL,
    output: { field: "text", render: "markdown" },
    mode: "sync",
    timeoutS: 30,
    enabled: true,
    featureIds: ["f1", "f2"],
  };

  it("ADM-FR-20 · M2-R25 · giống hệt; featureIds cùng tập khác thứ tự; khoá inputMap đổi chỗ → []", async () => {
    const r = await loadCommandsRules();
    expect(r.changedCommandFields(cur, structuredClone(cur))).toEqual([]);
    expect(r.changedCommandFields(cur, { ...cur, featureIds: ["f2", "f1"] })).toEqual([]);
    const swapped = { target_lang: FULL.target_lang, source_text: FULL.source_text };
    expect(r.changedCommandFields(cur, { ...cur, inputMap: swapped })).toEqual([]);
  });

  it("ADM-FR-20 · M2-R25 · aliases đổi thứ tự → có aliases", async () => {
    const r = await loadCommandsRules();
    expect(r.changedCommandFields(cur, { ...cur, aliases: ["d2", "tr"] })).toEqual(["aliases"]);
  });

  it("ADM-FR-20 · M2-R25 · mỗi trường đổi → đúng khoá đó (đổi mode không kéo theo timeoutS)", async () => {
    const r = await loadCommandsRules();
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ name: "dich2" }, "name"],
      [{ description: { vi: "Dịch", en: "Translate" } }, "description"],
      [{ workflowId: "w2" }, "workflowId"],
      [{ args: [arg("lang")] }, "args"],
      [{ inputMap: { source_text: { source: "selection" } } }, "inputMap"],
      [{ output: { field: "text", render: "json" } }, "output"],
      [{ mode: "async" }, "mode"],
      [{ timeoutS: 60 }, "timeoutS"],
      [{ enabled: false }, "enabled"],
      [{ featureIds: ["f1"] }, "featureIds"],
    ];
    for (const [patch, key] of cases) {
      expect(r.changedCommandFields(cur, { ...cur, ...patch })).toEqual([key]);
    }
  });
});
