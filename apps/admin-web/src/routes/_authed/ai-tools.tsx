import { createFileRoute, redirect } from "@tanstack/react-router";
import { type AiToolKind, aiToolsDestination, parseAiToolKind } from "@/features/shell/lib/nav";

// CR-121 R1 · c10: `/ai-tools?kind=workflow|command|agent` là địa chỉ mới của "Công cụ AI". Tạm chuyển tới danh mục
// `/workflows` đến khi lát c16 thay bằng màn thật (chip Workflow · Lệnh · Agent).
export const Route = createFileRoute("/_authed/ai-tools")({
  validateSearch: (s: Record<string, unknown>): { kind?: AiToolKind } => ({
    kind: parseAiToolKind(s.kind),
  }),
  beforeLoad: ({ search }) => {
    throw redirect({ to: aiToolsDestination(search.kind), replace: true });
  },
});
