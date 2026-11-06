import { createFileRoute, redirect } from "@tanstack/react-router";

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
  // CR-121 R2: danh sách Workflow nay là chip "Workflow" của Công cụ AI (editor `/workflows/new`, `/workflows/<id>` giữ nguyên).
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/ai-tools",
      search: { kind: "workflow", secret: search.secret, q: search.q },
      replace: true,
    });
  },
});
