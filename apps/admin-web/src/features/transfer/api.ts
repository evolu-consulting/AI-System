// ADM-FR-54 · gọi /admin/export* (nơi duy nhất của feature transfer; FE5b thêm /admin/import).
import type { ExportMeta, TransferType } from "@ai/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { downloadFile } from "@/lib/download";
import { api } from "@/lib/http";

export const EXPORT_META_KEY = ["transfer", "export-meta"] as const;

export function useExportMeta() {
  return useQuery({
    queryKey: EXPORT_META_KEY,
    refetchOnWindowFocus: true,
    queryFn: () => api<ExportMeta>("/admin/export/meta"),
  });
}

/** Tải `config-v{n}.yaml`; tên thật lấy từ `Content-Disposition`, thiếu thì dùng `fallbackName`. */
export function useExportDownload() {
  return useMutation({
    mutationFn: (v: { types: TransferType[]; fallbackName: string }) =>
      downloadFile("/admin/export", {
        query: { types: v.types.join(",") },
        fallbackName: v.fallbackName,
      }),
  });
}
