// HUB-FR-92 · HUB-FR-77 · HUB-BR-03 · HUB-H2b-AC-02 · H2b-R11 · toAgentMenuItem, agentMenu (test-plan H2b §4
// R20–R21, cases §1.4; chữ ký plan-rules).
import { describe, expect, it } from "bun:test";
import { AgentMenuItemSchema } from "@ai/contracts/chat";
import {
  agentMenu,
  toAgentMenuItem,
} from "../../../../apps/hub-api/src/modules/agents/agent-menu.rules";
import { A, agentCfg, LAN_WHO, snapshot, TADMIN_WHO } from "./_access";

describe("HUB-FR-92 · menu `@` [R20–R21]", () => {
  it("HUB-FR-92 · R20 · toAgentMenuItem chỉ {key, name{vi,en}, description}, parse schema strict [H2b-R11]", () => {
    const a = agentCfg(A.assistant, "assistant", {
      name: { vi: "Trợ lý", en: "Assistant" },
      systemPrompt: "bí mật",
      runtimeOptions: { x: 1 },
    });
    const item = toAgentMenuItem(a);
    expect(Object.keys(item).sort()).toEqual(["description", "key", "name"]);
    expect(item).toEqual({
      key: "assistant",
      name: { vi: "Trợ lý", en: "Assistant" },
      description: a.description,
    });
    expect(AgentMenuItemSchema.parse(item)).toEqual(item);
  });

  it("HUB-FR-92 · HUB-BR-03 · R21 · agentMenu = AU sắp key; không Orchestrator mặc định/tenant, không runtime llm [H2b-R11]", () => {
    const items = agentMenu(snapshot(), LAN_WHO);
    expect(items.map((i) => i.key)).toEqual(["assistant", "helper", "writer"]);
    expect(items[0]?.name).toEqual({ vi: "Trợ lý", en: "Assistant" });
    for (const i of items) expect(AgentMenuItemSchema.parse(i)).toEqual(i);
  });

  it("HUB-FR-77 · R21 · user không grant → [] [H2b-R11]", () => {
    expect(agentMenu(snapshot(), TADMIN_WHO)).toEqual([]);
  });
});
