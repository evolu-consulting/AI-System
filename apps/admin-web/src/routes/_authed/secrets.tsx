import { createFileRoute } from "@tanstack/react-router";
import { SecretsPage } from "@/features/secrets/pages/SecretsPage";

export type SecretsSearch = {
  q?: string;
  used?: boolean;
  page?: number;
  drawer?: "new" | "replace" | "note";
  secret?: string;
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
/** Boolean thật để URL là `?used=false` (chuỗi sẽ bị TanStack bọc thành `"false"`); nhận cả "true"/"false" gõ tay. */
const bool = (v: unknown): boolean | undefined =>
  v === true || v === "true" ? true : v === false || v === "false" ? false : undefined;
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined =>
  allowed.find((a) => a === v);

// Viết tay thay zod (như users): bộ lọc nằm trên URL, đổi bộ lọc bỏ `page`. `used` là boolean.
export const Route = createFileRoute("/_authed/secrets")({
  validateSearch: (s: Record<string, unknown>): SecretsSearch => {
    const page = Number(s.page);
    return {
      q: str(s.q),
      used: bool(s.used),
      page: Number.isInteger(page) && page > 1 ? page : undefined,
      drawer: oneOf(s.drawer, ["new", "replace", "note"]),
      secret: str(s.secret),
    };
  },
  component: SecretsPage,
});
