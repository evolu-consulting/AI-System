// CR-149 · hộp «Xem» DÙNG CHUNG cho tệp trong hệ thống: tên, cỡ, người tải lên/lúc (nếu có), «Tải về» + nội dung (ảnh / PDF / Word).
// Nơi gọi truyền `load` (lấy bytes qua route có kiểm quyền); hộp chỉ tải khi mở và không giữ cache khi đóng.
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { DownloadLink, FilePreview } from "./FilePreview";

export type FileViewerProps = {
  open: boolean;
  onClose: () => void;
  name: string;
  mime: string;
  size?: string;
  uploader?: string;
  uploadedAt?: string;
  /** Khoá cache riêng cho tệp (vd ["own-file", contractId, fileId]). */
  cacheKey: readonly unknown[];
  load: (signal: AbortSignal) => Promise<Blob>;
};

function Body(p: FileViewerProps) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ["file-viewer", ...p.cacheKey],
    queryFn: ({ signal }) => p.load(signal),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const blob = useMemo(
    () => (q.data ? new Blob([q.data], { type: p.mime }) : null),
    [q.data, p.mime],
  );
  if (q.isPending) return <p className="p-4 text-label text-dim">{t("contracts.fview.loading")}</p>;
  if (!blob)
    return (
      <p role="alert" className="p-4 text-sm text-late">
        {t("contracts.fview.error")}
      </p>
    );
  return (
    <>
      <div className="flex justify-end">
        <DownloadLink blob={blob} name={p.name} />
      </div>
      <FilePreview blob={blob} name={p.name} mime={p.mime} />
    </>
  );
}

export function FileViewerDialog(p: FileViewerProps) {
  const { t, i18n } = useTranslation();
  const meta = [
    p.size,
    p.uploader ? t("contracts.fview.uploadedBy", { who: p.uploader }) : null,
    p.uploadedAt
      ? t("contracts.fview.uploadedAt", {
          at: new Date(p.uploadedAt).toLocaleString(i18n.language),
        })
      : null,
  ].filter(Boolean);
  return (
    <Dialog open={p.open} onOpenChange={(o) => !o && p.onClose()}>
      <DialogContent className="flex h-[88dvh] flex-col sm:max-w-4xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="truncate">{p.name}</DialogTitle>
          <p className="m-0 text-caption text-dim" data-testid="fview-meta">
            {meta.join(" · ") || t("contracts.fview.title")}
          </p>
        </DialogHeader>
        {p.open && <Body {...p} />}
      </DialogContent>
    </Dialog>
  );
}
