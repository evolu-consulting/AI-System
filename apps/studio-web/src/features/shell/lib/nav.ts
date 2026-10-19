// HUB-FR-72 · CR-080 · menu Studio: chỉ các mục đã làm (link thật); mục chưa làm không hiển thị.
import { frozenModulesOn } from "#/lib/frozen";
export type NavId = "agents" | "orchestrator" | "models" | "secrets" | "settings" | "access";

export type NavItem = {
  id: NavId;
  kind: "link";
  to: "/agents" | "/orchestrator" | "/models" | "/secrets" | "/settings" | "/access";
};

export type NavGroup = {
  labelKey: "nav.group.config" | "nav.group.access" | "nav.group.system";
  items: NavItem[];
};

const ALL_GROUPS: NavGroup[] = [
  {
    labelKey: "nav.group.config",
    items: [
      { id: "agents", kind: "link", to: "/agents" },
      { id: "orchestrator", kind: "link", to: "/orchestrator" },
      { id: "models", kind: "link", to: "/models" },
      { id: "secrets", kind: "link", to: "/secrets" },
    ],
  },
  { labelKey: "nav.group.access", items: [{ id: "access", kind: "link", to: "/access" }] },
  { labelKey: "nav.group.system", items: [{ id: "settings", kind: "link", to: "/settings" }] },
];

/** F1 (CR-095): "Cài đặt" (KnowledgeHub cũ) đóng băng; nhóm rỗng thì bỏ. */
export const NAV_GROUPS: NavGroup[] = ALL_GROUPS.map((g) => ({
  ...g,
  items: g.items.filter((i) => frozenModulesOn || i.id !== "settings"),
})).filter((g) => g.items.length > 0);
