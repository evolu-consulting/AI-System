// HUB-FR-92 · H2b-R11 · menu `@` (GET `/agents`, plan-rules). Thuần. B0: chỉ chữ ký (B3).
import type { AgentMenuItem } from "@ai/contracts/chat";
import type { AgentConfig } from "../config/config.rules";
import type { AccessSnapshot, AccessSubject } from "./agent-access.rules";

/** `{key, name: {vi, en}, description}` — không trường khác. */
export function toAgentMenuItem(_a: AgentConfig): AgentMenuItem {
  throw new Error("not implemented: toAgentMenuItem");
}

/** R11: AU của `who` (sắp `key`) qua `visibleAgents(accessInput(s, who))`, tra `AgentConfig`. */
export function agentMenu(_s: AccessSnapshot, _who: AccessSubject): AgentMenuItem[] {
  throw new Error("not implemented: agentMenu");
}
