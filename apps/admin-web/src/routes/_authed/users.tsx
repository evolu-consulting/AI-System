import { createFileRoute } from "@tanstack/react-router";
import { UsersPage } from "@/features/users/pages/UsersPage";

export type UsersSearch = {
  tenant?: string;
  q?: string;
  status?: "active" | "locked";
  role?: "platform_admin" | "tenant_admin" | "member";
  login?: "never";
  page?: number;
  drawer?: "new" | "edit";
  user?: string;
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined =>
  allowed.find((a) => a === v);

// Viết tay thay zod: validateSearch nằm trong bundle ban đầu. Mọi bộ lọc nằm trên URL (đổi bộ lọc → bỏ `page`).
export const Route = createFileRoute("/_authed/users")({
  validateSearch: (s: Record<string, unknown>): UsersSearch => {
    const page = Number(s.page);
    return {
      tenant: str(s.tenant),
      q: str(s.q),
      status: oneOf(s.status, ["active", "locked"]),
      role: oneOf(s.role, ["platform_admin", "tenant_admin", "member"]),
      login: oneOf(s.login, ["never"]),
      page: Number.isInteger(page) && page > 1 ? page : undefined,
      drawer: oneOf(s.drawer, ["new", "edit"]),
      user: str(s.user),
    };
  },
  component: UsersPage,
});
