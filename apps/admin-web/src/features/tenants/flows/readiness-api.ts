// CR-125 · c5b · client readiness của mẫu Thư viện (Hub) + sửa một chạm của platform (admin-api).
import type { TemplateReadiness } from "@ai/contracts/modules";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";
import { hubConfigured, hubUrl } from "@/lib/hub";
import type { FixKind } from "./lib/readiness-view";

const enc = encodeURIComponent;
const key = (tid: string, flowId: string) => ["flow-readiness", tid, flowId] as const;

export const useTemplateReadiness = (tid: string, flowId: string, enabled = true) =>
  useQuery({
    queryKey: key(tid, flowId),
    enabled: hubConfigured() && enabled && tid !== "" && flowId !== "",
    retry: false,
    queryFn: () => {
      const u = hubUrl(`/tenants/${enc(tid)}/company-flows/readiness/${enc(flowId)}`);
      if (u === null) throw new Error("PUBLIC_HUB_URL chưa cấu hình: không gọi Hub");
      return api<TemplateReadiness>(u);
    },
  });

/** Nút một chạm: bật tính năng / tạo nhóm theo gợi ý ⇒ đọc lại readiness. */
export function useTemplateFix(tid: string, flowId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { fix: FixKind; key: string }) =>
      api<unknown>(`/admin/tenants/${enc(tid)}/template-fixes/${a.fix}`, {
        method: "POST",
        body: a.fix === "enable-feature" ? { feature_key: a.key } : { group_key: a.key },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(tid, flowId) }),
  });
}
