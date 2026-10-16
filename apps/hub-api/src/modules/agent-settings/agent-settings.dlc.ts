// DLC-R13 · (thuần) agent của AI SDLC trong `/agent-settings`: supervisor `dlc` (runtime_options.role = supervisor, `team`)
// hoặc vai trò engine (`agent_type_key = dlc-role`, runtime_options {role, step, kind, model, supervisor}). Khác → `{}`.
import type { DlcAgentInfo } from "@ai/contracts/hub-admin";

const DLC_ROLE_TYPE = "dlc-role";
const s = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

type Row = { agent_type_key: string | null; runtime_options: Record<string, unknown> | null };

export function dlcInfoOf(r: Row): { dlc?: DlcAgentInfo } {
  const o = r.runtime_options ?? {};
  if (r.agent_type_key === DLC_ROLE_TYPE) {
    return {
      dlc: {
        role: s(o.role, 48) || "?",
        step: s(o.step, 40),
        kind: o.kind === "agentic" ? "agentic" : "complete",
        model: s(o.model, 100),
        supervisor: s(o.supervisor, 48) || null,
        team: [],
      },
    };
  }
  if (o.role === "supervisor") {
    const team = Array.isArray(o.team) ? o.team.filter((k) => typeof k === "string") : [];
    return {
      dlc: {
        role: "supervisor",
        step: "",
        kind: "supervisor",
        model: "",
        supervisor: null,
        team: team.slice(0, 100).map((k) => String(k).slice(0, 48)),
      },
    };
  }
  return {};
}
