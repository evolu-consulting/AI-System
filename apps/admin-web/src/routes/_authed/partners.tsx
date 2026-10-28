import { createFileRoute } from "@tanstack/react-router";
import { PartnersPage } from "@/features/partners/pages/PartnersPage";

export type PartnersSearch = {
  tenant?: string;
  q?: string;
  page?: number;
  /** Id công ty đang mở trong drawer tài khoản. */
  org?: string;
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

// Viết tay thay zod (như users/groups): bộ lọc nằm trên URL, đổi bộ lọc bỏ `page`.
export const Route = createFileRoute("/_authed/partners")({
  validateSearch: (s: Record<string, unknown>): PartnersSearch => {
    const page = Number(s.page);
    return {
      tenant: str(s.tenant),
      q: str(s.q),
      page: Number.isInteger(page) && page > 1 ? page : undefined,
      org: str(s.org),
    };
  },
  component: PartnersPage,
});
