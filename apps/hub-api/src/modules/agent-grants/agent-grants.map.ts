// HUB-FR-78 · ADM-FR-37 · H3b-R11 · ánh xạ hàng DB → contract `@ai/contracts/hub-admin` (plan H3b §2.2). Thuần, không I/O.
import { BETA_GROUP_KEY } from "@ai/contracts";
import {
  AGENT_GRANTS_PER_AGENT_MAX,
  type AgentGrantListItem,
  type AgentGrantRow,
  type GrantSubject,
} from "@ai/contracts/hub-admin";
import { RUNNABLE_RUNTIMES } from "../agents/agent-access.rules";
import type { ListAgentRow, ListGrantRow, SubjectRow } from "./agent-grants.repo";

export function subjectRef(s: SubjectRow): GrantSubject {
  if (s.type === "group") {
    const group = { id: s.id, key: s.key, name: s.name, is_beta: s.key === BETA_GROUP_KEY };
    return { type: "group", group };
  }
  return { type: "user", user: { id: s.id, username: s.username, display_name: s.displayName } };
}

/** `subject_key` của audit/`entity_name`: key group hoặc username. */
export const subjectKey = (s: SubjectRow): string => (s.type === "group" ? s.key : s.username);

/** Hàng LIST_GRANTS (đã bỏ mồ côi bằng join) → `AgentGrantRow`. */
function grantRowOf(r: ListGrantRow): AgentGrantRow {
  const subject: SubjectRow =
    r.subject_type === "group"
      ? {
          type: "group",
          id: r.subject_id,
          key: r.group_key ?? "",
          name: r.group_name ?? { vi: "" },
        }
      : {
          type: "user",
          id: r.subject_id,
          username: r.username ?? "",
          displayName: r.display_name ?? "",
        };
  return {
    id: r.id,
    subject: subjectRef(subject),
    granted_by: r.granted_by,
    granted_at: new Date(r.granted_at).toISOString(),
  };
}

/** Ghép agent (đã cắt ≤ max) với grant theo agent; mỗi agent cắt `AGENT_GRANTS_PER_AGENT_MAX`, giữ `grants_total`. */
export function listItems(agents: ListAgentRow[], grants: ListGrantRow[]): AgentGrantListItem[] {
  const byAgent = new Map<string, ListGrantRow[]>();
  for (const g of grants) {
    const list = byAgent.get(g.agent_id) ?? [];
    list.push(g);
    byAgent.set(g.agent_id, list);
  }
  return agents.map((a) => {
    const rows = byAgent.get(a.id) ?? [];
    return {
      agent: {
        id: a.id,
        key: a.key,
        name: a.name,
        description: a.description,
        enabled: a.enabled,
        runnable: RUNNABLE_RUNTIMES.has(a.runtime),
      },
      grants: rows.slice(0, AGENT_GRANTS_PER_AGENT_MAX).map(grantRowOf),
      grants_total: rows.length,
    };
  });
}
