// CR-181 · s14 · cổng hook cho màn «Xem bản đã ký» (component không fetch): phiên (tên tệp, số chỗ ký) + các bản của tệp.
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { fetchPdfAt, fetchSession, fetchVersions, sessionKey, versionsKey } from "../api";

export const useSignedSession = (id: string) =>
  useQuery({ queryKey: sessionKey(id), queryFn: ({ signal }) => fetchSession(id, signal) });

export const useSignedVersions = (id: string, fileId: string | undefined) =>
  useQuery({
    queryKey: versionsKey(id, fileId ?? ""),
    queryFn: ({ signal }) => fetchVersions(id, fileId ?? "", signal),
    enabled: !!fileId,
  });

/** Nạp PDF của một bản (đường đầy đủ) thành ArrayBuffer cho pdf.js. */
export const loadPdfAt = async (path: string) => (await fetchPdfAt(path)).arrayBuffer();

/** Tải PDF của bản về máy (bấm «Tải về»). */
export function useDownloadPdf() {
  return useCallback(async (path: string, name: string) => {
    const blob = await fetchPdfAt(path);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }, []);
}
