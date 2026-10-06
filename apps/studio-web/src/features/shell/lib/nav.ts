// HUB-FR-72 · menu Studio theo ui-agent-studio §2; H4a chỉ Agents + Orchestrator là link, còn lại "Sắp có" (plan-frontend §2).
import type { SoonKind } from "#/components/shared/SoonBadge";

export type NavId =
  | "overview"
  | "agents"
  | "orchestrator"
  | "tools"
  | "models"
  | "secrets"
  | "access"
  | "playground"
  | "runs"
  | "cost"
  | "jobs"
  | "audit"
  | "transfer";

export type NavItem =
  | { id: NavId; kind: "link"; to: "/agents" | "/orchestrator" }
  | { id: NavId; kind: "soon"; soon: SoonKind };

export type NavGroup = {
  labelKey:
    | "nav.group.config"
    | "nav.group.access"
    | "nav.group.test"
    | "nav.group.ops"
    | "nav.group.system"
    | null;
  items: NavItem[];
};

const soon = (id: NavId, kind: SoonKind = "soon"): NavItem => ({ id, kind: "soon", soon: kind });

export const NAV_GROUPS: NavGroup[] = [
  { labelKey: null, items: [soon("overview")] },
  {
    labelKey: "nav.group.config",
    items: [
      { id: "agents", kind: "link", to: "/agents" },
      { id: "orchestrator", kind: "link", to: "/orchestrator" },
      soon("tools", "soonH4b"),
      soon("models", "soonH4b"),
      soon("secrets", "soonH4b"),
    ],
  },
  { labelKey: "nav.group.access", items: [soon("access", "soonH4b")] },
  { labelKey: "nav.group.test", items: [soon("playground", "soonH4c")] },
  { labelKey: "nav.group.ops", items: [soon("runs"), soon("cost"), soon("jobs")] },
  { labelKey: "nav.group.system", items: [soon("audit"), soon("transfer")] },
];
