import { createFileRoute, redirect } from "@tanstack/react-router";

export type CommandsSearch = {
  q?: string;
  status?: "on" | "off";
  feature?: string;
  workflow?: string;
  page?: number;
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

// Viết tay thay zod (như users): bộ lọc nằm trên URL, đổi bộ lọc bỏ `page`.
export const Route = createFileRoute("/_authed/commands/")({
  validateSearch: (s: Record<string, unknown>): CommandsSearch => {
    const page = Number(s.page);
    return {
      q: str(s.q),
      status: s.status === "on" || s.status === "off" ? s.status : undefined,
      feature: str(s.feature),
      workflow: str(s.workflow),
      page: Number.isInteger(page) && page > 1 ? page : undefined,
    };
  },
  // CR-121 R1: danh sách Lệnh nay là chip "Lệnh" của Công cụ AI (editor `/commands/new`, `/commands/<id>` giữ nguyên).
  beforeLoad: () => {
    throw redirect({ to: "/ai-tools", search: { kind: "command" }, replace: true });
  },
});
