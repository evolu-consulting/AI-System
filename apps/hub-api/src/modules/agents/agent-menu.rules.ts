// HUB-FR-92 · H2b-R11 · menu `@` (GET `/agents`, plan-rules). Thuần — đọc ảnh cấu hình, 0 query.
import { AGENT_MENU_MAX, type AgentMenuItem } from "@ai/contracts/chat";
import type { AgentConfig, ConfigSnapshot } from "../config/config.rules";
import { type AccessSubject, accessInput, visibleAgents } from "./agent-access.rules";

/** `{key, name: {vi, en}, description}` — không trường khác (không lộ system prompt/runtime/profile). */
export function toAgentMenuItem(a: AgentConfig): AgentMenuItem {
  return { key: a.key, name: { vi: a.name.vi, en: a.name.en }, description: a.description };
}

/** R11: AU của `who` (sắp `key`) qua `visibleAgents(accessInput(s, who))`, tra `AgentConfig`; tối đa `AGENT_MENU_MAX`. */
export function agentMenu(s: ConfigSnapshot, who: AccessSubject): AgentMenuItem[] {
  const byId = new Map(s.agents.map((a) => [a.id, a]));
  const items: AgentMenuItem[] = [];
  for (const v of visibleAgents(accessInput(s, who))) {
    const a = byId.get(v.id);
    if (a) items.push(toAgentMenuItem(a));
    if (items.length >= AGENT_MENU_MAX) break;
  }
  return items;
}
