import { createFileRoute } from "@tanstack/react-router";
import { GroupsPage } from "@/features/groups/pages/GroupsPage";

export type GroupsSearch = {
  tenant?: string;
  q?: string;
  page?: number;
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

// Viết tay thay zod (như users): bộ lọc nằm trên URL, đổi bộ lọc bỏ `page`.
export const Route = createFileRoute("/_authed/groups/")({
  validateSearch: (s: Record<string, unknown>): GroupsSearch => {
    const page = Number(s.page);
    return {
      tenant: str(s.tenant),
      q: str(s.q),
      page: Number.isInteger(page) && page > 1 ? page : undefined,
    };
  },
  component: GroupsPage,
});
