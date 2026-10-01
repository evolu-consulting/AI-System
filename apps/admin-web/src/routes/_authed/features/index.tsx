import { createFileRoute } from "@tanstack/react-router";
import { FeaturesPage } from "@/features/features/pages/FeaturesPage";

export type FeaturesSearch = {
  q?: string;
  status?: "on" | "beta" | "off";
  page?: number;
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined =>
  allowed.find((a) => a === v);

// Viết tay thay zod (như users): bộ lọc nằm trên URL, đổi bộ lọc bỏ `page`.
export const Route = createFileRoute("/_authed/features/")({
  validateSearch: (s: Record<string, unknown>): FeaturesSearch => {
    const page = Number(s.page);
    return {
      q: str(s.q),
      status: oneOf(s.status, ["on", "beta", "off"]),
      page: Number.isInteger(page) && page > 1 ? page : undefined,
    };
  },
  component: FeaturesPage,
});
