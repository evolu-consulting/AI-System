// dlc-step-library · client Hub của thư viện BƯỚC DLC (`/dlc-step-templates`, chỉ platform_admin). Kiểu từ
// `packages/contracts/src/hub-admin/dlc-step-templates.ts`. Trang "Bước DLC" sửa; Canvas khe `dlc.*` đọc để chèn bước.
import type {
  DlcStepTemplate,
  DlcStepTemplateInput,
  DlcStepTemplateListResponse,
} from "@ai/contracts/hub-admin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";
import { hubConfigured, hubUrl } from "@/lib/hub";

const KEY = ["process", "dlc-step-templates"] as const;
const url = (path: string): string => {
  const u = hubUrl(path);
  if (u === null) throw new Error("PUBLIC_HUB_URL chưa cấu hình: không gọi Hub");
  return u;
};
const P = (id?: string) =>
  id ? `/dlc-step-templates/${encodeURIComponent(id)}` : "/dlc-step-templates";

export const useDlcStepTemplates = (enabled: boolean) =>
  useQuery({
    queryKey: KEY,
    enabled: enabled && hubConfigured(),
    staleTime: 30_000,
    queryFn: async () => (await api<DlcStepTemplateListResponse>(url(P()))).items,
  });

/** Lưu (thêm khi vắng `id`, sửa kèm `version`) / xoá; xong ⇒ làm tươi danh sách. */
export function useDlcStepWrite() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: KEY });
  const save = useMutation({
    mutationFn: (v: { id?: string; version?: number; body: DlcStepTemplateInput }) =>
      v.id
        ? api<DlcStepTemplate>(url(P(v.id)), {
            method: "PUT",
            body: { ...v.body, version: v.version },
          })
        : api<DlcStepTemplate>(url(P()), { method: "POST", body: v.body }),
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api<undefined>(url(P(id)), { method: "DELETE" }),
    onSuccess: done,
  });
  return { save, remove };
}
