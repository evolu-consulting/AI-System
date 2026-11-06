// CR-121 R6 · c16 · gọi API Công cụ AI (nơi duy nhất): "Dùng bởi" cả danh mục, "Công ty dùng" của một công cụ, công tắc theo công ty.
// Công tắc dùng lại `PUT|DELETE /admin/tenants/:id/workflow-tools/:workflow_id` (không đổi) — chỉ đổi chỗ gọi (D6, chuyển từ tab công ty).
import type { AiToolList, WorkflowCompanyList } from "@ai/contracts/workflow-tools";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";

export const AI_TOOL_KEYS = {
  // Bắt đầu bằng "workflows" ⇒ bật/tắt/xoá workflow (invalidate WORKFLOW_KEYS.all) tự làm mới danh sách này.
  usage: ["workflows", "ai-tools"] as const,
  companies: (workflowId: string) => ["ai-tools", "companies", workflowId] as const,
};

/** Toàn danh mục kèm "Dùng bởi" — một lượt đọc; lọc/tìm làm ở client (≤ 200 công cụ). */
export function useAiToolUsage() {
  return useQuery({
    queryKey: AI_TOOL_KEYS.usage,
    queryFn: () => api<AiToolList>("/admin/ai-tools"),
  });
}

/** Công ty + công tắc của một công cụ; chỉ nạp khi mở ngăn chi tiết. */
export function useWorkflowCompanies(workflowId: string | undefined) {
  return useQuery({
    queryKey: AI_TOOL_KEYS.companies(workflowId ?? ""),
    enabled: !!workflowId,
    queryFn: () => api<WorkflowCompanyList>(`/admin/workflow-tools/${workflowId}/companies`),
  });
}

/** Bật (`PUT`, body rỗng) / tắt (`DELETE`); xong làm mới danh sách công ty và số "Công ty dùng" (không optimistic). */
export function useSetCompanyTool(workflowId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tenantId, on }: { tenantId: string; on: boolean }) =>
      api<unknown>(`/admin/tenants/${tenantId}/workflow-tools/${workflowId}`, {
        method: on ? "PUT" : "DELETE",
        body: on ? {} : undefined,
      }),
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: AI_TOOL_KEYS.companies(workflowId) }),
        qc.invalidateQueries({ queryKey: AI_TOOL_KEYS.usage }),
      ]),
  });
}
