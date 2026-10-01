// ADM-FR-13, ADM-FR-14, ADM-FR-15, ADM-FR-22 · luật thuần workflows (plan.md §4 `workflows.rules.ts`;
// M2-R09, M2-R11, M2-R18). Không DB.
import { describe, expect, it } from "bun:test";
import { loadWorkflowsRules } from "../_modules";

const cmd = (id: string, name: string, enabled: boolean) => ({ id, name, enabled });
const inp = (name: string, required: boolean, type = "text") => ({
  name,
  type,
  required,
  description: `Tham số ${name}`,
});
const SCHEMA = [inp("source_text", true), inp("target_lang", true), inp("tone", false)];
const full = {
  source_text: { source: "selection" },
  target_lang: { source: "const", value: "vi" },
};
const AGENT = { id: "01900000-0000-7000-8000-0000000002a1" };

describe("ADM-FR-14 · isUnattached (M2-R09)", () => {
  it("ADM-FR-14 · M2-R09 · chỉ khi không command và không agent", async () => {
    const r = await loadWorkflowsRules();
    expect(r.isUnattached({ commandCount: 0, agentCount: 0 })).toBe(true);
    expect(r.isUnattached({ commandCount: 1, agentCount: 0 })).toBe(false);
    expect(r.isUnattached({ commandCount: 0, agentCount: 1 })).toBe(false);
    expect(r.isUnattached({ commandCount: 2, agentCount: 3 })).toBe(false);
  });
});

describe("ADM-FR-13 · chặn xoá/tắt (M2-R11)", () => {
  it("ADM-FR-13 · AC-A05 · checkWorkflowDelete: không dùng → null", async () => {
    const r = await loadWorkflowsRules();
    expect(r.checkWorkflowDelete({ commands: [], agents: [] })).toBeNull();
  });

  it("ADM-FR-13 · AC-A05 · checkWorkflowDelete: chỉ command TẮT vẫn chặn; chỉ agent chặn; cả hai liệt kê đủ", async () => {
    const r = await loadWorkflowsRules();
    const off = [cmd("c1", "tr-nhanh", false)];
    expect(r.checkWorkflowDelete({ commands: off, agents: [] })).toEqual({
      code: "WORKFLOW_IN_USE",
      details: { action: "delete", commands: off, agents: [] },
    });
    expect(r.checkWorkflowDelete({ commands: [], agents: [AGENT] })).toMatchObject({
      code: "WORKFLOW_IN_USE",
      details: { action: "delete", commands: [], agents: [AGENT] },
    });
    const both = {
      commands: [cmd("c1", "dich", true), cmd("c2", "tr-nhanh", false)],
      agents: [AGENT],
    };
    expect(r.checkWorkflowDelete(both)).toEqual({
      code: "WORKFLOW_IN_USE",
      details: { action: "delete", ...both },
    });
  });

  it("ADM-FR-13 · M2-AC06 · checkWorkflowDisable: chỉ command tắt, không agent → null", async () => {
    const r = await loadWorkflowsRules();
    expect(
      r.checkWorkflowDisable({ commands: [cmd("c1", "tr-nhanh", false)], agents: [] }),
    ).toBeNull();
    expect(r.checkWorkflowDisable({ commands: [], agents: [] })).toBeNull();
  });

  it("ADM-FR-13 · M2-AC06 · checkWorkflowDisable: có command BẬT → details.commands chỉ gồm command bật, agents đủ", async () => {
    const r = await loadWorkflowsRules();
    const on = cmd("c1", "dich", true);
    const off = cmd("c2", "tr-nhanh", false);
    expect(r.checkWorkflowDisable({ commands: [off, on], agents: [AGENT] })).toEqual({
      code: "WORKFLOW_IN_USE",
      details: { action: "disable", commands: [on], agents: [AGENT] },
    });
  });

  it("ADM-FR-13 · M2-R11 · checkWorkflowDisable: chỉ agent → vẫn chặn (commands rỗng)", async () => {
    const r = await loadWorkflowsRules();
    expect(r.checkWorkflowDisable({ commands: [cmd("c2", "x1", false)], agents: [AGENT] })).toEqual(
      {
        code: "WORKFLOW_IN_USE",
        details: { action: "disable", commands: [], agents: [AGENT] },
      },
    );
  });

  it("ADM-FR-13 · M2-R11 · thứ tự đầu vào được giữ trong details", async () => {
    const r = await loadWorkflowsRules();
    const cs = [cmd("c9", "zeta", true), cmd("c1", "alpha", true)];
    const res = r.checkWorkflowDisable({ commands: cs, agents: [] });
    expect(res.details.commands.map((c: { name: string }) => c.name)).toEqual(["zeta", "alpha"]);
  });
});

describe("ADM-FR-22 · inputMapGaps / findBrokenCommands (M2-R17, M2-R18)", () => {
  it("ADM-FR-22 · M2-R17 · inputMapGaps: missing theo thứ tự schema, chỉ required; unknown theo thứ tự khoá map", async () => {
    const r = await loadWorkflowsRules();
    expect(r.inputMapGaps(SCHEMA, { source_text: { source: "selection" } })).toEqual({
      missing: ["target_lang"],
      unknown: [],
    });
    expect(r.inputMapGaps(SCHEMA, {})).toEqual({
      missing: ["source_text", "target_lang"],
      unknown: [],
    });
    const map = { zz: { source: "selection" }, ...full, aa: { source: "selection" } };
    expect(r.inputMapGaps(SCHEMA, map)).toEqual({ missing: [], unknown: ["zz", "aa"] });
  });

  it("ADM-FR-22 · M2-R17 · inputMapGaps: input không bắt buộc thiếu không tính; schema rỗng + map rỗng → rỗng", async () => {
    const r = await loadWorkflowsRules();
    expect(r.inputMapGaps(SCHEMA, full)).toEqual({ missing: [], unknown: [] });
    expect(r.inputMapGaps([], {})).toEqual({ missing: [], unknown: [] });
  });

  it("ADM-FR-22 · M2-R18 · findBrokenCommands: bỏ command lành, sắp theo name, mỗi mục có missing/unknown", async () => {
    const r = await loadWorkflowsRules();
    const cmds = [
      { id: "c2", name: "zz", inputMap: {} },
      { id: "c1", name: "aa", inputMap: full },
      { id: "c3", name: "mm", inputMap: { ...full, gone: { source: "selection" } } },
    ];
    expect(r.findBrokenCommands(SCHEMA, cmds)).toEqual([
      { id: "c3", name: "mm", missing: [], unknown: ["gone"] },
      { id: "c2", name: "zz", missing: ["source_text", "target_lang"], unknown: [] },
    ]);
  });
});

describe("ADM-FR-22 · checkSchemaChange (M2-AC08)", () => {
  it("ADM-FR-22 · M2-AC08 · không command hỏng → null", async () => {
    const r = await loadWorkflowsRules();
    expect(r.checkSchemaChange(SCHEMA, [{ id: "c1", name: "dich", inputMap: full }])).toBeNull();
    expect(r.checkSchemaChange(SCHEMA, [])).toBeNull();
  });

  it("ADM-FR-22 · M2-AC08 · có command hỏng → SCHEMA_BREAKS_COMMANDS {commands}", async () => {
    const r = await loadWorkflowsRules();
    const newSchema = [inp("source_text", true), inp("lang", true)];
    expect(r.checkSchemaChange(newSchema, [{ id: "c1", name: "dich", inputMap: full }])).toEqual({
      code: "SCHEMA_BREAKS_COMMANDS",
      details: {
        commands: [{ id: "c1", name: "dich", missing: ["lang"], unknown: ["target_lang"] }],
      },
    });
  });
});

describe("ADM-FR-10 · changedWorkflowFields (M2-R25)", () => {
  const cur = {
    name: "Translate",
    description: "Dịch văn bản theo yêu cầu của người dùng",
    appType: "workflow",
    baseUrl: "https://dify.example.com/v1",
    secretId: "s1",
    inputSchema: SCHEMA,
    outputField: "text" as string | null,
    enabled: true,
  };

  it("ADM-FR-10 · M2-R25 · giống hệt (kể cả input_schema là mảng mới cùng nội dung) → []", async () => {
    const r = await loadWorkflowsRules();
    expect(r.changedWorkflowFields(cur, { ...cur })).toEqual([]);
    expect(r.changedWorkflowFields(cur, { ...cur, inputSchema: structuredClone(SCHEMA) })).toEqual(
      [],
    );
  });

  it("ADM-FR-10 · M2-R25 · mỗi trường đổi → đúng khoá đó", async () => {
    const r = await loadWorkflowsRules();
    const cases: Array<[Partial<typeof cur>, string]> = [
      [{ name: "X" }, "name"],
      [{ description: "Mô tả mới dài đủ hai mươi ký tự" }, "description"],
      [{ appType: "chat" }, "appType"],
      [{ baseUrl: "https://other.example.com" }, "baseUrl"],
      [{ secretId: "s2" }, "secretId"],
      [{ outputField: null }, "outputField"],
      [{ enabled: false }, "enabled"],
    ];
    for (const [patch, key] of cases) {
      expect([...r.changedWorkflowFields(cur, { ...cur, ...patch })].sort()).toEqual([key]);
    }
  });

  it("ADM-FR-10 · M2-R25 · input_schema đổi thứ tự tham số → có inputSchema; đổi nội dung → có inputSchema", async () => {
    const r = await loadWorkflowsRules();
    const reordered = [...SCHEMA].reverse();
    expect(r.changedWorkflowFields(cur, { ...cur, inputSchema: reordered })).toEqual([
      "inputSchema",
    ]);
    const edited = SCHEMA.map((p, i) => (i === 0 ? { ...p, required: false } : p));
    expect(r.changedWorkflowFields(cur, { ...cur, inputSchema: edited })).toEqual(["inputSchema"]);
  });
});
