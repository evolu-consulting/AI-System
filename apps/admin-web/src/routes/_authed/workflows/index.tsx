import { createFileRoute } from "@tanstack/react-router";
import { WorkflowsPage } from "@/features/workflows/pages/WorkflowsPage";

export type WorkflowsSearch = {
  q?: string;
  status?: "on" | "off" | "unattached";
  secret?: string;
  page?: number;
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined =>
  allowed.find((a) => a === v);

// Viết tay thay zod (như users): bộ lọc nằm trên URL, đổi bộ lọc bỏ `page`.
export const Route = createFileRoute("/_authed/workflows/")({
  validateSearch: (s: Record<string, unknown>): WorkflowsSearch => {
    const page = Number(s.page);
    return {
      q: str(s.q),
      status: oneOf(s.status, ["on", "off", "unattached"]),
      secret: str(s.secret),
      page: Number.isInteger(page) && page > 1 ? page : undefined,
    };
  },
  component: WorkflowsPage,
});
