// HUB-FR-72 · CR-080 · menu Studio: chỉ các mục đã làm (link thật); mục chưa làm không hiển thị.
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

export const NAV_GROUPS: NavGroup[] = [
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
