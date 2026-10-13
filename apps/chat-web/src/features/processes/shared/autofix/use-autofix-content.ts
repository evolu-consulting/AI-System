// HUB-FR-128 · P-c1 FC4/§2 · hook tải nội dung diff/log tự sửa qua `load(attachmentId)` (Bearer); bất biến theo id ⇒ staleTime 5 phút.
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { parseDiff, tailLines } from "../lib/diff-parse";
import { notifyDownloadError } from "./notify";

/** Tải nội dung tệp đính kèm (chat: `fetchAttachmentContent`; admin: kèm `tenant_id`). */
export type LoadContent = (attachmentId: string) => Promise<Blob>;
export type AutofixFileRef = { id: string; name: string };

const STALE_MS = 5 * 60_000;

function useText(id: string | null, load: LoadContent, enabled: boolean) {
  return useQuery({
    queryKey: ["autofix-diff", id],
    enabled: enabled && id !== null,
    staleTime: STALE_MS,
    queryFn: async () => (await load(id as string)).text(),
  });
}

/** Diff đã phân tích (một lần / `text`), cắt 2.000 dòng. */
export function useAutofixDiff(id: string | null, load: LoadContent, enabled = true) {
  const q = useText(id, load, enabled);
  const parsed = useMemo(() => (q.data === undefined ? null : parseDiff(q.data)), [q.data]);
  return { parsed, isError: q.isError, refetch: q.refetch };
}

/** Đuôi `tail` dòng của log test. */
export function useAutofixLog(id: string | null, load: LoadContent, enabled = true, tail = 30) {
  const q = useText(id, load, enabled);
  const text = useMemo(
    () => (q.data === undefined ? null : tailLines(q.data, tail)),
    [q.data, tail],
  );
  return { text, isLoading: q.isLoading, isError: q.isError };
}

/** Tải về: blob (Bearer) → `<a download>`; lỗi ⇒ toast. */
export function useDownload(load: LoadContent) {
  const { t } = useTranslation();
  return useCallback(
    async (file: AutofixFileRef) => {
      try {
        const url = URL.createObjectURL(await load(file.id));
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch {
        notifyDownloadError(t("process.common.autofix.download.err"));
      }
    },
    [load, t],
  );
}
