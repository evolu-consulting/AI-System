// S05 · "Xem hợp đồng gốc": hộp thoại xem tại chỗ (PDF/ảnh) + tải xuống, kèm tệp của các phụ lục (mỗi phụ lục là một HĐ có tệp riêng).
// Quyền xem do server quyết (RLS của `file-link`: HĐ không thấy ⇒ 404); ở đây chỉ trình bày. Tệp tải bằng link FileBox ngắn hạn rồi hiện qua blob URL.
import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { fetchSourceText, sourceKey } from "~/features/contract-source/api";
import {
  contractKey,
  fetchContract,
  fetchOriginalBlob,
  isPreviewable,
  openOriginalFile,
} from "../api";

export type OriginalEntry = {
  id: string;
  label: string;
  name: string;
  mime: string;
  hasSource?: boolean;
};

const APPENDIX_FILES_MAX = 20;

/** Tệp của các phụ lục: đọc chi tiết từng phụ lục (chỉ khi mở hộp thoại; ≤ 20) rồi lấy `file`. */
function useAppendixEntries(appendices: { id: string; title: string }[]): OriginalEntry[] {
  const list = appendices.slice(0, APPENDIX_FILES_MAX);
  const results = useQueries({
    queries: list.map((a) => ({
      queryKey: contractKey(a.id),
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchContract(a.id, signal),
      staleTime: 60_000,
    })),
  });
  return list.flatMap((a, i) => {
    const f = results[i]?.data?.file;
    return f
      ? [
          {
            id: a.id,
            label: a.title,
            name: f.name,
            mime: f.mime,
            hasSource: results[i]?.data?.has_source === true,
          },
        ]
      : [];
  });
}

/** Tá»‡p khÃ´ng xem trÆ°á»›c Ä‘Æ°á»£c (vd .docx) â‡’ hiá»‡n chá»¯ Ä‘Ã£ Ä‘á»c tá»« tá»‡p (cÃ¹ng nguá»“n vá»›i khoang "VÄƒn báº£n gá»‘c"); khÃ´ng cÃ³ â‡’ bÃ¡o nhÆ° cÅ©. */
function NoPreview({ entry }: { entry: OriginalEntry }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: sourceKey(entry.id),
    queryFn: ({ signal }) => fetchSourceText(entry.id, signal),
    staleTime: 60_000,
    enabled: entry.hasSource === true,
  });
  if (!entry.hasSource || q.error || (q.data !== undefined && q.data.trim() === ""))
    return <p className="p-4 text-label text-dim">{t("contracts.review.orig.noPreview")}</p>;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <p role="status" className="text-label text-dim">
        {t("contracts.review.orig.noPreviewText")}
      </p>
      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-rule bg-sunk p-3 text-[13px] leading-relaxed">
        {q.isPending ? (
          <span className="text-dim">{t("contracts.review.orig.loading")}</span>
        ) : (
          <div className="whitespace-pre-wrap break-words" data-testid="orig-source-text">
            {q.data}
          </div>
        )}
      </div>
    </div>
  );
}

function Viewer({ entry }: { entry: OriginalEntry }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ["original-file", entry.id],
    queryFn: ({ signal }) => fetchOriginalBlob(entry.id, entry.mime, signal),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const url = useMemo(() => (q.data ? URL.createObjectURL(q.data) : null), [q.data]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  if (q.isPending)
    return <p className="p-4 text-label text-dim">{t("contracts.review.orig.loading")}</p>;
  if (!url)
    return (
      <p role="alert" className="p-4 text-sm text-late">
        {t("contracts.review.orig.failed")}{" "}
        <button type="button" className="underline" onClick={() => void openOriginalFile(entry.id)}>
          {t("contracts.review.orig.newTab")}
        </button>
      </p>
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex justify-end">
        <a href={url} download={entry.name} className="btn btn-outline">
          {t("contracts.review.orig.download")}
        </a>
      </div>
      {!isPreviewable(entry.mime) ? (
        <NoPreview entry={entry} />
      ) : entry.mime === "application/pdf" ? (
        <iframe
          title={entry.name}
          src={url}
          className="min-h-0 w-full flex-1 rounded-md border border-rule"
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-rule bg-sunk p-2">
          <img src={url} alt={entry.name} className="mx-auto max-h-full max-w-full" />
        </div>
      )}
    </div>
  );
}

export function OriginalFileDialog({
  contractId,
  file,
  hasSource,
  appendices,
  onClose,
}: {
  contractId: string;
  hasSource?: boolean;
  file: { name: string; mime: string } | null;
  appendices: { id: string; title: string }[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const extra = useAppendixEntries(appendices);
  const entries: OriginalEntry[] = [
    ...(file
      ? [
          {
            id: contractId,
            label: t("contracts.review.orig.main"),
            name: file.name,
            mime: file.mime,
            hasSource: hasSource === true,
          },
        ]
      : []),
    ...extra,
  ];
  const [pick, setPick] = useState(contractId);
  const current = entries.find((e) => e.id === pick) ?? entries[0];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[88dvh] flex-col sm:max-w-4xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("contracts.review.orig.title")}</DialogTitle>
        </DialogHeader>
        {entries.length > 1 && (
          <div
            role="tablist"
            aria-label={t("contracts.review.orig.appendices")}
            className="flex flex-wrap gap-1"
          >
            {entries.map((e) => (
              <button
                key={e.id}
                type="button"
                role="tab"
                aria-selected={e.id === current?.id}
                className={`btn ${e.id === current?.id ? "btn-primary" : "btn-quiet"}`}
                onClick={() => setPick(e.id)}
              >
                {e.label}
              </button>
            ))}
          </div>
        )}
        {current && <Viewer key={current.id} entry={current} />}
      </DialogContent>
    </Dialog>
  );
}

/** Chỉ dựng hộp thoại khi `open` (tách điều kiện khỏi trang để giữ độ phức tạp thấp). */
export function OriginalFileHost({
  open,
  ...p
}: { open: boolean } & Parameters<typeof OriginalFileDialog>[0]) {
  return open ? <OriginalFileDialog {...p} /> : null;
}
