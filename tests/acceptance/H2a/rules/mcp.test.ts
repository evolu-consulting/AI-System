// HUB-FR-50 · WRK-FR-13 · HUB-BR-11 · HUB-BR-19 · HUB-FR-23 · H2a-R18–R20, P7 · luật thuần MCP `/mcp`
// (test-plan H2a §4 R50–R55, cases §1.7; chữ ký plan-rules).
import { describe, expect, it } from "bun:test";
import { MCP_PROTOCOL_VERSIONS } from "@ai/contracts/hub-internal";
import {
  mcpToolsFor,
  negotiateProtocol,
  parseRpc,
  toolInputSchema,
  toolTimeoutS,
  validateToolArgs,
} from "../../../../apps/hub-api/src/modules/mcp/mcp.rules";
import { input, uid, workflow } from "./_catalog";

const INVALID = { kind: "error", code: -32600 } as const;

describe("HUB-FR-50 · JSON-RPC + phiên bản [R50, R51]", () => {
  it("HUB-FR-50 · parseRpc: hợp lệ (có/không id, id chuỗi); batch/thiếu method/jsonrpc sai/không object → -32600 [R50]", () => {
    expect(parseRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" })).toMatchObject({
      kind: "request",
      id: 1,
      method: "tools/list",
    });
    const params = { name: "check-invoice", arguments: { x: "1" } };
    expect(parseRpc({ jsonrpc: "2.0", id: "a-1", method: "tools/call", params })).toEqual({
      kind: "request",
      id: "a-1",
      method: "tools/call",
      params,
    });
    expect(parseRpc({ jsonrpc: "2.0", method: "notifications/initialized" })).toMatchObject({
      kind: "request",
      id: null,
      method: "notifications/initialized",
    });
    const bad: unknown[] = [
      [{ jsonrpc: "2.0", id: 1, method: "ping" }],
      { jsonrpc: "2.0", id: 1 },
      { jsonrpc: "1.0", id: 1, method: "ping" },
      { id: 1, method: "ping" },
      "x",
      null,
      42,
    ];
    for (const b of bad) expect(parseRpc(b)).toMatchObject(INVALID);
  });

  it("HUB-FR-50 · negotiateProtocol: bản đã biết giữ; lạ → 2026-07-28 [R51]", () => {
    for (const v of MCP_PROTOCOL_VERSIONS) expect(negotiateProtocol(v)).toBe(v);
    for (const v of ["1999-01-01", undefined, 20250618, null, ""])
      expect(negotiateProtocol(v)).toBe("2026-07-28");
  });
});

describe("HUB-FR-50 · tools [R52–R55]", () => {
  it("HUB-FR-50 · AC-H12 · toolInputSchema: kiểu, enum select, required, mô tả từng tham số [R52]", () => {
    const s = toolInputSchema([
      input("x", "text", { description: "Mã hoá đơn" }),
      input("n", "number", { required: true, description: "Số lượng" }),
      input("b", "boolean", { description: "Cờ" }),
      input("lang", "select", { required: true, options: ["en", "vi"], description: "Ngôn ngữ" }),
    ]);
    expect(s.type).toBe("object");
    expect(s.properties).toEqual({
      x: { type: "string", description: "Mã hoá đơn" },
      n: { type: "number", description: "Số lượng" },
      b: { type: "boolean", description: "Cờ" },
      lang: { type: "string", enum: ["en", "vi"], description: "Ngôn ngữ" },
    });
    expect([...s.required].sort()).toEqual(["lang", "n"]);
  });

  it("HUB-FR-50 · HUB-BR-11 · HUB-BR-19 · mcpToolsFor: agent ∩ enabled ∩ allowed, bỏ file bắt buộc, sắp name [R53]", () => {
    const w = (n: number, key: string, o = {}) =>
      workflow({ id: uid(n), key, description: `Mô tả ${key}`, ...o });
    const zeta = w(1, "zeta-tool", { inputSchema: [input("x", "text", { description: "X" })] });
    const alpha = w(2, "alpha-tool");
    const off = w(3, "off-tool", { enabled: false });
    const notAgent = w(4, "other-tool");
    const notAllowed = w(5, "hidden-tool");
    const file = w(6, "file-tool", { inputSchema: [input("f", "file", { required: true })] });
    const tools = mcpToolsFor({
      agentWorkflowIds: new Set([uid(1), uid(2), uid(3), uid(5), uid(6)]),
      workflows: [zeta, alpha, off, notAgent, notAllowed, file],
      allowed: ["zeta-tool", "alpha-tool", "off-tool", "other-tool", "file-tool"],
    });
    expect(tools.map((t) => t.name)).toEqual(["alpha-tool", "zeta-tool"]);
    expect(tools[1]).toEqual({
      name: "zeta-tool",
      description: "Mô tả zeta-tool",
      inputSchema: {
        type: "object",
        properties: { x: { type: "string", description: "X" } },
        required: [],
      },
    });
  });

  it("HUB-FR-50 · H2a-R20 · validateToolArgs: đúng → ok + query; thiếu/sai kiểu/không object → ok:false [R54]", () => {
    const schema = [
      input("x", "text", { required: true }),
      input("n", "number"),
      input("flag", "boolean"),
      input("lang", "select", { options: ["en", "vi"] }),
    ];
    expect(validateToolArgs(schema, { x: "a", n: 3, flag: true, lang: "vi" })).toEqual({
      ok: true,
      inputs: { x: "a", n: 3, flag: true, lang: "vi" },
      query: null,
    });
    const withQuery = [input("query", "text", { required: true })];
    expect(validateToolArgs(withQuery, { query: "hỏi" })).toMatchObject({ ok: true, query: "hỏi" });
    const bad: unknown[] = [
      {},
      { x: "a", n: "abc" },
      { x: "a", flag: "maybe" },
      { x: "a", lang: "ja" },
      { x: 5 },
      null,
      "x",
      [],
    ];
    for (const b of bad) expect(validateToolArgs(schema, b)).toEqual({ ok: false });
  });

  it("HUB-FR-50 · H2a-R20 · toolTimeoutS = min(agent, max) [R55]", () => {
    expect(toolTimeoutS(1, 300)).toBe(1);
    expect(toolTimeoutS(300, 300)).toBe(300);
    expect(toolTimeoutS(900, 300)).toBe(300);
  });
});
