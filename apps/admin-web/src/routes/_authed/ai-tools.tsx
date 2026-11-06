import { createFileRoute } from "@tanstack/react-router";
import {
  parseStatus,
  parseUsageKind,
  type StatusFilter,
  type UsageKind,
} from "@/features/ai-tools/lib/ai-tools";
import { AiToolsPage } from "@/features/ai-tools/pages/AiToolsPage";

export type AiToolsSearch = {
  /** Địa chỉ cũ `/commands`, `/agents` chuyển tới `kind=command|agent` (lọc theo loại dùng); `workflow` = không lọc. */
  kind?: UsageKind;
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
    kind: parseUsageKind(s.kind),
    status: parseStatus(s.status),
    q: str(s.q),
    tool: str(s.tool),
    notice: s.notice === "company-tools" ? "company-tools" : undefined,
  }),
  component: AiToolsPage,
});
