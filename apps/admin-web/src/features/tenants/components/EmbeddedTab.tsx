// CR-112 · CR-121 c14 · mục con của tab Thành viên nhúng màn có sẵn (Người dùng, Nhóm, Đối tác, Phân quyền, Agents); nạp lười khi mở.
import { lazy, Suspense } from "react";
import { EmbeddedProvider } from "@/components/shared/embedded";
import { LoadingState } from "@/components/shared/states/LoadingState";
import type { MemberView } from "../lib/workspace-tabs";

/** Mục con của tab Thành viên (CR-121 c14) — mỗi mục nhúng màn có sẵn. */
export type EmbeddedTabId = MemberView;

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
