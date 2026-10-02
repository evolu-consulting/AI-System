import { createFileRoute } from "@tanstack/react-router";
import { GroupEditorPage } from "@/features/groups/pages/GroupEditorPage";

export type GroupEditorSearch = {
  tab?: "members" | "features" | "agents";
  tenant?: string;
  q?: string;
  page?: number;
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const TABS = ["members", "features", "agents"] as const;

export const Route = createFileRoute("/_authed/groups/$groupId")({
  validateSearch: (s: Record<string, unknown>): GroupEditorSearch => {
    const page = Number(s.page);
    return {
      tab: TABS.find((t) => t === s.tab),
      tenant: str(s.tenant),
      q: str(s.q),
      page: Number.isInteger(page) && page > 1 ? page : undefined,
    };
  },
  component: GroupEditorPage,
});
