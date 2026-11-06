import { createFileRoute } from "@tanstack/react-router";
import {
  type AiToolKind,
  parseKind,
  parseStatus,
  type StatusFilter,
} from "@/features/ai-tools/lib/ai-tools";
import { AiToolsPage } from "@/features/ai-tools/pages/AiToolsPage";

export type AiToolsSearch = {
  /** Chip loại: agent · command · workflow (`/commands`, `/agents` cũ chuyển tới đây). */
  kind?: AiToolKind;
  status?: StatusFilter;
  q?: string;
  /** Công cụ đang mở ngăn chi tiết. */
  tool?: string;
  /** `company-tools`: tới từ `/tenants/<id>?tab=workflow-tools` (tab đã gỡ). */
  notice?: "company-tools";
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

// CR-121 R1/R6 · c16: "Công cụ AI" — danh sách gộp + ngăn chi tiết (thay điểm đến tạm /workflows của c10).
export const Route = createFileRoute("/_authed/ai-tools")({
  validateSearch: (s: Record<string, unknown>): AiToolsSearch => ({
    kind: parseKind(s.kind),
    status: parseStatus(s.status),
    q: str(s.q),
    tool: str(s.tool),
    notice: s.notice === "company-tools" ? "company-tools" : undefined,
  }),
  component: AiToolsPage,
});
