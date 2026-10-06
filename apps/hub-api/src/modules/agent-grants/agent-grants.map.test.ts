// HUB-FR-78 · H3b-R11 · unit ánh xạ hàng DB → contract `/agent-grants` (cắt grant theo agent, `runnable`, `is_beta`).
import { describe, expect, it } from "bun:test";
import { AGENT_GRANTS_PER_AGENT_MAX, AgentGrantListItemSchema } from "@ai/contracts/hub-admin";
import { listItems, subjectKey, subjectRef } from "./agent-grants.map";
import type { ListAgentRow, ListGrantRow } from "./agent-grants.repo";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const agent = (n: number, runtime: string): ListAgentRow => ({
  id: uuid(n),
  key: `a${n}`,
  name: { vi: `A${n}`, en: `A${n}` },
  description: "",
  enabled: true,
  runtime,
});
const userGrant = (n: number, agentId: string): ListGrantRow => ({
  id: uuid(1000 + n),
  agent_id: agentId,
  subject_type: "user",
  subject_id: uuid(5000 + n),
  granted_at: "2026-10-06T00:00:00Z",
  granted_by: null,
  group_key: null,
  group_name: null,
  username: `u${n}`,
  display_name: `U ${n}`,
});

describe("agent-grants.map", () => {
  it("HUB-FR-78 · subjectRef group có is_beta theo key; subjectKey = key/username", () => {
    const g = { type: "group" as const, id: uuid(1), key: "beta-testers", name: { vi: "Beta" } };
    expect(subjectRef(g)).toEqual({
      type: "group",
      group: { id: g.id, key: g.key, name: g.name, is_beta: true },
    });
    const u = { type: "user" as const, id: uuid(2), username: "lan", displayName: "Lan" };
    expect(subjectRef(u)).toEqual({
      type: "user",
      user: { id: uuid(2), username: "lan", display_name: "Lan" },
    });
    expect([subjectKey(g), subjectKey(u)]).toEqual(["beta-testers", "lan"]);
  });

  it("HUB-FR-78 · listItems cắt grant mỗi agent ở max, giữ grants_total; runnable theo runtime; hợp contract", () => {
    const a1 = agent(1, "agentic-cli");
    const a2 = agent(2, "llm");
    const grants = Array.from({ length: AGENT_GRANTS_PER_AGENT_MAX + 1 }, (_, i) =>
      userGrant(i, a1.id),
    );
    const items = listItems([a1, a2], grants);
    expect(
      items.map((i) => [i.agent.key, i.agent.runnable, i.grants.length, i.grants_total]),
    ).toEqual([
      ["a1", true, AGENT_GRANTS_PER_AGENT_MAX, AGENT_GRANTS_PER_AGENT_MAX + 1],
      ["a2", false, 0, 0],
    ]);
    for (const i of items) expect(AgentGrantListItemSchema.safeParse(i).success).toBe(true);
  });
});
