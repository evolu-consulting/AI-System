// CR-149 · phần "nội dung" dùng chung: nhận Blob đã tải (do nơi gọi lấy bằng route có kiểm quyền), chọn ảnh / PDF / Word / «Tải về».
// pdf.js và docx-preview chỉ nạp khi gặp đúng loại (dynamic import trong từng pane).
import { FileText } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { viewerKind } from "./viewer-kind";

const PdfPane = lazy(() => import("./PdfPane"));
const DocxPane = lazy(() => import("./DocxPane"));

export function useBlobUrl(blob: Blob | null): string | null {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  return url;
}

export function DownloadLink({ blob, name, small }: { blob: Blob; name: string; small?: boolean }) {
  const { t } = useTranslation();
  const url = useBlobUrl(blob);
  return url ? (
    <a
      href={url}
      download={name}
      className={small ? "text-caption text-act underline" : "btn btn-outline btn-sm"}
      data-testid="fview-download"
    >
      {t("contracts.fview.download")}
    </a>
  ) : null;
}

export function FilePreview({ blob, name, mime }: { blob: Blob; name: string; mime: string }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const onError = useCallback(() => setFailed(true), []);
  const kind = viewerKind(mime, name);
  const imgUrl = useBlobUrl(kind === "image" ? blob : null);
  if (failed)
    return (
      <p role="alert" className="m-0 p-2 text-sm text-late">
        {t("contracts.fview.error")}
      </p>
    );
  if (kind === "image")
    return (
      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-rule bg-sunk p-2">
        {imgUrl && (
          <img
            src={imgUrl}
            alt={name}
            className="mx-auto max-h-full max-w-full"
            data-testid="fview-image"
          />
        )}
      </div>
    );
  if (kind === "pdf" || kind === "docx") {
    const Pane = kind === "pdf" ? PdfPane : DocxPane;
    return (
      <Suspense
        fallback={<p className="p-4 text-label text-dim">{t("contracts.fview.loading")}</p>}
      >
        <Pane blob={blob} onError={onError} />
      </Suspense>
    );
  }
  return (
    <div className="grid gap-2 p-2 text-sm" data-testid="fview-other">
      <p className="m-0 flex items-center gap-2 font-medium">
        <FileText size={16} aria-hidden /> {name}
      </p>
      <p className="m-0 text-dim">{t("contracts.fview.noPreview")}</p>
    </div>
  );
}
