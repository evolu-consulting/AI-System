// ADM-FR-54 · gọi /admin/export* và /admin/import (nơi duy nhất của feature transfer).
import type {
  ExportMeta,
  ImportPreview,
  ImportRequest,
  ImportResult,
  TransferType,
} from "@ai/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { downloadFile } from "@/lib/download";
import { api } from "@/lib/http";

export const EXPORT_META_KEY = ["transfer", "export-meta"] as const;

/** Gốc query bị import ghi đè hoặc tính lại (plan-frontend §3.5 Import 3). */
const IMPORT_AFFECTED_ROOTS = [
  "transfer",
  "workflows",
  "commands",
  "features",
  "tenants",
  "groups",
  "grants",
  "access",
  "secrets",
  "quotas",
  "quota-banner",
  "overview",
  "usage",
  "audit",
] as const;

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

/** Xem trước (`dry_run=1`, không ghi). Nội dung file chỉ nằm trong bộ nhớ (`gcTime: 0`). */
export function useImportDryRun() {
  return useMutation({
    gcTime: 0,
    mutationFn: (body: Pick<ImportRequest, "file_name" | "content">) =>
      api<ImportPreview>("/admin/import", { method: "POST", query: { dry_run: "1" }, body }),
  });
}

/** Áp dụng (`dry_run=0`); giá trị secret chỉ đi trong body, không cache (D11). */
export function useImportCommit() {
  const qc = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: (body: ImportRequest) =>
      api<ImportResult>("/admin/import", { method: "POST", query: { dry_run: "0" }, body }),
    onSuccess: () => {
      for (const root of IMPORT_AFFECTED_ROOTS) void qc.invalidateQueries({ queryKey: [root] });
    },
  });
}
