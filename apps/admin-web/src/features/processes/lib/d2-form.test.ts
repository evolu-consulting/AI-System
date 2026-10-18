// HUB-FR-146 · HUB-FR-147 · AC-H44 · AC-H45 · P-d2 · T20-FE: đổi qua lại stage "Gọi tool" / "Rẽ nhánh" ⇄ contract, luật thuần domain
// (parity với contract), validate live dùng chung hàm contract, cạnh canvas.
import { describe, expect, test } from "bun:test";
import {
  BRANCH_OPS,
  BRANCH_RULES_MAX,
  type ProcessStageDef,
  type ProcessToolItem,
} from "@ai/contracts/hub-admin";
import {
  BRANCH_RULES_MAX as D_MAX,
  BRANCH_OPS as D_OPS,
  gotoSteps,
  isStandalone,
  opsForType,
  targetHasReal,
} from "../domain/branch-rules";
import { fieldOptions, inputOptions, paramCompatible, TOOL_ARGS_LIMIT } from "../domain/tool-rules";
import { branchToRules, emptyBranch, rulesToBranch } from "./branch-form";
import { layoutSteps } from "./canvas-layout";
import { branchErrors, d2LiveErrors, toolErrors, toolSubmitErrors } from "./d2-validate";
import type { StageDraft } from "./draft-types";
import { emptyStage, stageToDraft, stageToInput } from "./stage-convert";
import { hasArg, normalizeTool, setArg, switchTool, toolFromDef, toolToDef } from "./tool-form";

const CATALOG: ProcessToolItem[] = [
  {
    key: "xuat-hd",
    name: "Xuất HĐ",
    description: "Xuất hoá đơn",
    side_effect: false,
    params: [
      { name: "tong_tien", type: "number", required: true },
      { name: "ma_kh", type: "text", required: true },
      { name: "che_do", type: "select", required: false, options: ["day_du", "rut_gon"] },
    ],
  },
  {
    key: "ghi-so",
    name: "Ghi sổ",
    description: "Ghi sổ",
    side_effect: true,
    params: [{ name: "ma_kh", type: "text", required: true }],
  },
];

const st = (key: string, step: number, p: Partial<StageDraft> = {}): StageDraft => ({
  ...emptyStage(step),
  key,
  name: key,
  step,
  filename: `${key}.md`,
  template: "x",
  sections: ["Kết quả"],
  ...p,
});

describe("domain == contract", () => {
  test("hằng rẽ nhánh khai lại bằng contract", () => {
    expect([...D_OPS]).toEqual([...BRANCH_OPS]);
    expect(D_MAX).toBe(BRANCH_RULES_MAX);
  });
  test("paramCompatible: ma trận D2-29", () => {
    expect(paramCompatible("number", "number")).toBe(true);
    expect(paramCompatible("string", "number")).toBe(false);
    expect(paramCompatible("string", "select")).toBe(true);
    expect(paramCompatible("date", "select")).toBe(false);
    expect(paramCompatible("boolean", "text")).toBe(true);
    expect(paramCompatible("date", "date")).toBe(true);
    expect(TOOL_ARGS_LIMIT).toBe(20);
  });
});

describe("nguồn tham số", () => {
  const stages = [
    {
      key: "doc",
      name: "Đọc",
      step: 0,
      fields: [
        { key: "tong_tien", type: "number" },
        { key: "ghi_chu", type: "string" },
      ],
    },
    { key: "xhd", name: "Xuất", step: 1, fields: [] },
    { key: "cuoi", name: "Cuối", step: 2, fields: [{ key: "x", type: "number" }] },
  ];
  test("trường chỉ lấy từ bước nhỏ hơn và đúng kiểu", () => {
    expect(fieldOptions(stages, 1, "number").map((o) => o.value)).toEqual(["doc:tong_tien"]);
    expect(fieldOptions(stages, 1, "text").map((o) => o.value)).toEqual([
      "doc:tong_tien",
      "doc:ghi_chu",
    ]);
    expect(fieldOptions(stages, 0, "text")).toEqual([]);
  });
  test("input lọc theo kiểu tham số; tệp không làm nguồn", () => {
    const ins = [
      { key: "so", label: "Số", type: "number" },
      { key: "ten", label: "Tên", type: "text" },
      { key: "tep", label: "Tệp", type: "file" },
    ];
    expect(inputOptions(ins, "number").map((o) => o.value)).toEqual(["so"]);
    expect(inputOptions(ins, "text").map((o) => o.value)).toEqual(["so", "ten"]);
  });
});

describe("tool-form", () => {
  test("toolToDef bỏ nguồn chưa khai; số/bool theo kind; roundtrip", () => {
    let t = setArg({ key: "xuat-hd", args: {} }, "tong_tien", {
      from: "field",
      value: "doc:tong_tien",
    });
    t = setArg(t, "ma_kh", { from: "const", value: "KH1", kind: "string" });
    t = setArg(t, "che_do", { from: "" });
    const def = toolToDef(t);
    expect(def).toEqual({
      kind: "tool",
      tool_key: "xuat-hd",
      args: {
        tong_tien: { from: "field", stage_key: "doc", field: "tong_tien" },
        ma_kh: { from: "const", value: "KH1" },
      },
    });
    expect(toolToDef(toolFromDef(def))).toEqual(def);
    expect(hasArg(t, "che_do")).toBe(false);
    const n = setArg({ key: "k", args: {} }, "n", {
      from: "const",
      value: "20000000",
      kind: "number",
    });
    expect(toolToDef(n).args.n).toEqual({ from: "const", value: 20000000 });
    const bad = setArg({ key: "k", args: {} }, "n", {
      from: "const",
      value: "abc",
      kind: "number",
    });
    expect(toolToDef(bad).args).toEqual({});
    const b = setArg({ key: "k", args: {} }, "b", {
      from: "const",
      value: "false",
      kind: "boolean",
    });
    expect(toolToDef(b).args.b).toEqual({ from: "const", value: false });
  });
});

describe("tool-form · đổi tool, chuẩn hoá", () => {
  test("đổi tool giữ tham số trùng tên + kiểu (D2-35)", () => {
    const a = CATALOG[0] as ProcessToolItem;
    const b = CATALOG[1] as ProcessToolItem;
    let t = setArg({ key: a.key, args: {} }, "ma_kh", { from: "const", value: "KH1" });
    t = setArg(t, "tong_tien", { from: "input", value: "so" });
    const next = switchTool(t, b.key, a.params, b.params);
    expect(next.key).toBe("ghi-so");
    expect(Object.keys(next.args)).toEqual(["ma_kh"]);
  });
  test("normalizeTool ép trường khoá, giữ fields/filename/timeout", () => {
    const s = normalizeTool(
      st("x", 0, {
        executor: "tool",
        instruction: "bỏ",
        mustKnow: "m",
        answerer: "group",
        answererId: "g",
        budget: "5",
        timeout: "99",
        fields: [{ key: "a", type: "number", required: true }],
      }),
    );
    expect(s).toMatchObject({
      instruction: "",
      mustKnow: "",
      answerer: "starter",
      budget: "",
      timeout: "99",
      sections: ["Kết quả", "Bàn giao"],
    });
    expect(s.template).toBe("# x\n\n## Kết quả\n\n## Bàn giao\n");
    expect(s.fields).toHaveLength(1);
  });
});

describe("stage-convert", () => {
  test("stage tool + rẽ nhánh: draft ⇄ contract", () => {
    const def: ProcessStageDef = {
      key: "pl",
      name: "Phân loại",
      step: 0,
      executor: {
        kind: "tool",
        tool_key: "xuat-hd",
        args: { ma_kh: { from: "const", value: "A" } },
      },
      instruction: "",
      output: {
        filename: "pl.md",
        template: "t",
        required_sections: ["Kết quả"],
        fields: [{ key: "tong_tien", type: "number", required: true }],
      },
      after: {
        kind: "auto",
        branch: [{ field: "tong_tien", op: "ge", value: 20000000, goto_step: 3 }],
      },
      real_action: false,
      answerer: { kind: "starter" },
      timeout_s: 1800,
      token_budget: null,
      sources: [],
      must_know: [],
      autofix: null,
    };
    const d = stageToDraft(def, 0);
    expect(d.executor).toBe("tool");
    expect(d.branch).toEqual([{ field: "tong_tien", op: "ge", value: "20000000", goto: 4 }]);
    const back = stageToInput(d);
    expect(back.executor).toEqual(def.executor);
    expect(back.after.branch).toEqual(def.after.branch);
    expect(back.output.required_sections).toEqual(["Kết quả", "Bàn giao"]);
  });
  test("stage chờ ngày không rẽ nhánh dù nháp có luật", () => {
    const w = st("w", 0, {
      executor: "wait_until",
      wait: { source: "input:han", offset: "0", time: "09:00" },
      branch: [emptyBranch()],
    });
    expect(stageToInput(w).after.branch ?? []).toEqual([]);
  });
});

describe("branch-form + domain", () => {
  test("goto đếm từ 1 ⇄ goto_step 0-based; Số ⇒ number", () => {
    const f = [{ key: "n", type: "number" as const, required: false }];
    const r = branchToRules([{ field: "n", op: "gt", value: "5", goto: 3 }], f);
    expect(r).toEqual([{ field: "n", op: "gt", value: 5, goto_step: 2 }]);
    expect(rulesToBranch(r)).toEqual([{ field: "n", op: "gt", value: "5", goto: 3 }]);
    expect(branchToRules([emptyBranch()], f)[0]?.goto_step).toBe(-1);
    expect(rulesToBranch(undefined)).toEqual([]);
  });
  test("opsForType: chuỗi không có lt/le/gt/ge", () => {
    expect(opsForType("string")).toEqual(["eq", "ne"]);
    expect(opsForType("number")).toHaveLength(6);
  });
  test("isStandalone / gotoSteps / targetHasReal", () => {
    const s = [
      { step: 0, real: false },
      { step: 1, real: false },
      { step: 1, real: false },
      { step: 2, real: true },
    ];
    expect(isStandalone(s, 0)).toBe(true);
    expect(isStandalone(s, 1)).toBe(false);
    expect(gotoSteps(s, 0)).toEqual([1, 2]);
    expect(gotoSteps(s, 2)).toEqual([]);
    expect(targetHasReal(s, 2)).toBe(true);
    expect(targetHasReal(s, null)).toBe(false);
  });
});

describe("validate live (hàm contract)", () => {
  const fields = [{ key: "tong_tien", type: "number" as const, required: true }];
  test("rẽ nhánh: ô sai đúng path + khoá; đích real ⇒ khoá real", () => {
    const a = st("a", 0, {
      fields,
      branch: [{ field: "tong_tien", op: "eq", value: "x", goto: 2 }],
    });
    const e = branchErrors([a, st("b", 1)]);
    expect(e["stages.0.after.branch.0.value"]).toBe("process.admin.editor.stage.branch.err.value");
    const g = st("a", 0, {
      fields,
      branch: [{ field: "tong_tien", op: "eq", value: "1", goto: 2 }],
    });
    const real = branchErrors([g, st("b", 1, { real: true })]);
    expect(real["stages.0.after.branch.0.goto_step"]).toBe(
      "process.admin.editor.stage.branch.err.real",
    );
    const notStep = branchErrors([
      st("a", 0, { fields, branch: [{ field: "tong_tien", op: "eq", value: "1", goto: 1 }] }),
      st("b", 1),
    ]);
    expect(notStep["stages.0.after.branch.0.goto_step"]).toBe(
      "process.admin.editor.stage.branch.err.goto",
    );
  });
  test("rẽ nhánh: stage song song ⇒ lỗi cả khối", () => {
    const a = st("a", 0, {
      fields,
      branch: [{ field: "tong_tien", op: "eq", value: "1", goto: 2 }],
    });
    const e = branchErrors([a, st("b", 0), st("c", 1)]);
    expect(e["stages.0.after.branch"]).toBe("process.admin.editor.stage.branch.err.BRANCH_INVALID");
  });
});

describe("validate live · tool (hàm contract)", () => {
  test("tool: tác dụng phụ không real ⇒ TOOL_SIDE_EFFECT; nguồn sai ⇒ TOOL_INVALID; tool mất ⇒ ref", () => {
    const tool = setArg({ key: "ghi-so", args: {} }, "ma_kh", { from: "const", value: "A" });
    const s = st("t", 1, { executor: "tool", tool });
    const e = toolErrors([st("p", 0), s], [], CATALOG);
    expect(e["stages.1.real_action"]).toBe("process.admin.editor.stage.tool.err.TOOL_SIDE_EFFECT");
    const bad = setArg({ key: "xuat-hd", args: {} }, "tong_tien", {
      from: "const",
      value: "abc",
      kind: "string",
    });
    const e2 = toolErrors([st("p", 0), st("t", 1, { executor: "tool", tool: bad })], [], CATALOG);
    expect(e2["stages.1.executor.args.tong_tien"]).toBe(
      "process.admin.editor.stage.tool.err.TOOL_INVALID",
    );
    const gone = toolErrors(
      [st("t", 0, { executor: "tool", tool: { key: "khong-co", args: {} } })],
      [],
      CATALOG,
    );
    expect(gone["stages.0.executor.tool_key"]).toBe("process.admin.editor.stage.tool.err.ref");
    expect(toolErrors([s], [], undefined)).toEqual({});
  });
  test("lúc Lưu: thiếu tham số bắt buộc ⇒ argRequired; chưa chọn tool ⇒ pick", () => {
    const t = st("t", 0, { executor: "tool", tool: { key: "xuat-hd", args: {} } });
    const e = toolSubmitErrors([t], CATALOG);
    expect(e["stages.0.executor.args.tong_tien"]).toBe(
      "process.admin.editor.stage.tool.err.argRequired",
    );
    expect(e["stages.0.executor.args.che_do"]).toBeUndefined();
    const none = toolSubmitErrors([st("t", 0, { executor: "tool" })], CATALOG);
    expect(none["stages.0.executor"]).toBe("process.admin.editor.stage.tool.err.pick");
    // T20-FE2: tham số bắt buộc còn trống báo NGAY (live), không chờ Lưu.
    expect(d2LiveErrors([t], [], CATALOG)["stages.0.executor.args.tong_tien"]).toBe(
      "process.admin.editor.stage.tool.err.argRequired",
    );
  });
});

describe("canvas: cạnh rẽ nhánh", () => {
  const s = (uid: string, step: number, branch: (number | null)[] = []) => ({
    uid,
    step,
    backTo: [],
    after: "auto" as const,
    branch,
  });
  test("một cạnh mỗi luật hợp lệ, tới tiêu đề bước đích; đích sai/null bị bỏ", () => {
    const l = layoutSteps([s("a", 0, [2, 0, null, 9, 3]), s("b", 1), s("c", 2), s("d", 3)]);
    const br = l.edges.filter((e) => e.kind === "branch");
    expect(br.map((e) => `${e.source}>${e.target}#${e.rule}`)).toEqual(["a>h2#1", "a>h3#5"]);
  });
});
