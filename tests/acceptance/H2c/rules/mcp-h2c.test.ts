// HUB-FR-50 · H2c-R23 · P12 · K10 · MCP với file: mcpToolsFor(hasFiles), toolInputSchema(withFiles), fileArg,
// TOOL_FILE_TEXT (test-plan H2c §1, cases §1.6 R35–R38; chữ ký plan-rules §5).
import { describe, expect, it } from "bun:test";
import type { WorkflowInput } from "@ai/contracts";
import type { JobAttachment } from "@ai/contracts/hub";
import {
  fileArg,
  type McpToolsInput,
  mcpToolsFor,
  TOOL_FILE_TEXT,
  toolInputSchema,
} from "../../../../apps/hub-api/src/modules/mcp/mcp.rules";
import { input, workflow } from "../../H2a/rules/_catalog";
import { uid } from "./_rules";

const HOADON_INPUTS = [
  input("file", "file", { required: true, description: "Hoá đơn PDF" }),
  input("note", "text", { description: "Ghi chú" }),
];
const ANH_INPUTS = [
  input("img", "file", { description: "Ảnh" }),
  input("q", "text", { required: true, description: "Câu hỏi" }),
];
const HOADON = workflow({ id: uid(601), key: "hoadon-file", inputSchema: HOADON_INPUTS });
const ANH = workflow({ id: uid(602), key: "anh-tuy-chon", inputSchema: ANH_INPUTS });
const DICH = workflow({
  id: uid(603),
  key: "dich",
  inputSchema: [input("text", "text", { required: true, description: "Văn bản" })],
});
const BASE: McpToolsInput = {
  agentWorkflowIds: new Set([uid(601), uid(602), uid(603)]),
  workflows: [HOADON, ANH, DICH],
  allowed: ["hoadon-file", "anh-tuy-chon", "dich"],
};
const names = (i: McpToolsInput): string[] => mcpToolsFor(i).map((t) => t.name);
const FILE_SUFFIX = " (file name in attachments/)";

describe("HUB-FR-50 · mcpToolsFor hasFiles [R35]", () => {
  it("HUB-FR-50 · R35 · hasFiles vắng → H2a nguyên văn (bỏ file bắt buộc, schema không có input file) [H2c-R23 · K10]", () => {
    expect(names(BASE)).toEqual(["anh-tuy-chon", "dich"]);
    const anh = mcpToolsFor(BASE).find((t) => t.name === "anh-tuy-chon");
    expect(anh?.inputSchema).toEqual({
      type: "object",
      properties: { q: { type: "string", description: "Câu hỏi" } },
      required: ["q"],
    });
  });

  it("HUB-FR-50 · R35 · false → bỏ mọi workflow có input file; true → giữ cả, schema withFiles [H2c-R23 · HUB-H2c-AC-11]", () => {
    expect(names({ ...BASE, hasFiles: false })).toEqual(["dich"]);
    const tools = mcpToolsFor({ ...BASE, hasFiles: true });
    expect(tools.map((t) => t.name)).toEqual(["anh-tuy-chon", "dich", "hoadon-file"]);
    expect(tools.find((t) => t.name === "hoadon-file")?.inputSchema).toEqual(
      toolInputSchema(HOADON_INPUTS, true),
    );
    expect(tools.find((t) => t.name === "anh-tuy-chon")?.inputSchema.properties.img).toEqual({
      type: "string",
      description: `Ảnh${FILE_SUFFIX}`,
    });
  });
});

describe("HUB-FR-50 · toolInputSchema withFiles [R36]", () => {
  it("HUB-FR-50 · R36 · input file → chuỗi + mô tả (file name in attachments/); required theo input [H2c-R23]", () => {
    expect(toolInputSchema(HOADON_INPUTS, true)).toEqual({
      type: "object",
      properties: {
        file: { type: "string", description: `Hoá đơn PDF${FILE_SUFFIX}` },
        note: { type: "string", description: "Ghi chú" },
      },
      required: ["file"],
    });
    // Catalog cũ có thể thiếu mô tả: dùng tên input (plan-rules §5 `i.description ?? i.name`).
    const bare = { name: "img", type: "file", required: false } as unknown as WorkflowInput;
    expect(toolInputSchema([bare], true)).toEqual({
      type: "object",
      properties: { img: { type: "string", description: `img${FILE_SUFFIX}` } },
      required: [],
    });
  });

  it("HUB-FR-50 · R36 · withFiles vắng → như H2a (không có input file) [H2c-R23 · K10]", () => {
    expect(toolInputSchema(HOADON_INPUTS)).toEqual({
      type: "object",
      properties: { note: { type: "string", description: "Ghi chú" } },
      required: [],
    });
  });
});

const att = (n: number, name: string): JobAttachment => ({
  id: uid(n),
  name,
  mime: "application/pdf",
  size: 10,
  sha256: "a".repeat(64),
});

describe("HUB-FR-50 · fileArg, TOOL_FILE_TEXT [R37, R38]", () => {
  it("HUB-FR-50 · R37 · khớp name chính xác trước, rồi id; khác → null [H2c-R23 · HUB-H2c-AC-11]", () => {
    const a = att(701, "a.pdf");
    const b = att(702, "b.pdf");
    expect(fileArg("a.pdf", [a, b])).toEqual(a);
    expect(fileArg(uid(702), [a, b])).toEqual(b);
    const clash = att(703, uid(704)); // name mục 1 = id mục 2
    const target = att(704, "c.pdf");
    expect(fileArg(uid(704), [clash, target])).toEqual(clash);
    for (const v of ["A.pdf", "", 123, null, undefined, ["a.pdf"], "../a.pdf", "attachments/a.pdf"])
      expect(fileArg(v, [a, b])).toBeNull();
    expect(fileArg("a.pdf", [])).toBeNull();
  });

  it("HUB-FR-50 · R38 · TOOL_FILE_TEXT nguyên văn plan-errors §3 [H2c-R23]", () => {
    expect(TOOL_FILE_TEXT).toEqual({
      NOT_ATTACHED: "This file is not attached to this message.",
      REJECTED: "Dify rejected this file (type or size).",
    });
  });
});
