// CR-112 · ADM-FR-76 · tab của workspace công ty nhúng màn có sẵn (Người dùng, Nhóm, Đối tác, Phân quyền, Agents); nạp lười khi mở tab.
import { lazy, Suspense } from "react";
import { EmbeddedProvider } from "@/components/shared/embedded";
import { LoadingState } from "@/components/shared/states/LoadingState";
import type { TenantTab } from "../lib/workspace-tabs";

export type EmbeddedTabId = Extract<
  TenantTab,
  "users" | "groups" | "partners" | "access" | "agents"
>;

const PAGES = {
  users: lazy(() =>
    import("@/features/users/pages/UsersPage").then((m) => ({ default: m.UsersPage })),
  ),
  groups: lazy(() =>
    import("@/features/groups/pages/GroupsPage").then((m) => ({ default: m.GroupsPage })),
  ),
  partners: lazy(() =>
    import("@/features/partners/pages/PartnersPage").then((m) => ({ default: m.PartnersPage })),
  ),
  access: lazy(() =>
    import("@/features/access/pages/AccessPage").then((m) => ({ default: m.AccessPage })),
  ),
  agents: lazy(() =>
    import("@/features/agents/pages/AgentsPage").then((m) => ({ default: m.AgentsPage })),
  ),
} as const;

export const isEmbeddedTab = (tab: TenantTab): tab is EmbeddedTabId => tab in PAGES;

export function EmbeddedTab({ tab }: { tab: EmbeddedTabId }) {
  const Page = PAGES[tab];
  return (
    <EmbeddedProvider value>
      <Suspense fallback={<LoadingState />}>
        <Page />
      </Suspense>
    </EmbeddedProvider>
  );
}
