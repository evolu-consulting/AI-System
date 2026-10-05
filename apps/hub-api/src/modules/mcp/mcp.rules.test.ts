// HUB-FR-50 · H2a-R19 · REVIEW 1 Hub #6: `mcpToolsFor` bỏ app `chat`/`agent` thiếu input `query` (như `appNeedsQuery` của
// lệnh `/`); app `workflow` không cần `query`.
import { describe, expect, it } from "bun:test";
import { input, uid, workflow } from "../../../../../tests/acceptance/H2a/rules/_catalog";
import { mcpToolsFor } from "./mcp.rules";

describe("mcpToolsFor · app chat/agent cần query", () => {
  it("chat/agent không có query → bỏ; có query → giữ; workflow không query → giữ", () => {
    const w = (n: number, key: string, o = {}) => workflow({ id: uid(n), key, ...o });
    const q = [input("query", "text", { required: true })];
    const other = [input("x", "text")];
    const wfs = [
      w(1, "chat-no-query", { appType: "chat", inputSchema: other }),
      w(2, "agent-no-query", { appType: "agent", inputSchema: [] }),
      w(3, "chat-query", { appType: "chat", inputSchema: q }),
      w(4, "agent-query", { appType: "agent", inputSchema: q }),
      w(5, "wf-plain", { appType: "workflow", inputSchema: other }),
    ];
    const tools = mcpToolsFor({
      agentWorkflowIds: new Set(wfs.map((x) => x.id)),
      workflows: wfs,
      allowed: wfs.map((x) => x.key),
    });
    expect(tools.map((t) => t.name)).toEqual(["agent-query", "chat-query", "wf-plain"]);
  });
});
