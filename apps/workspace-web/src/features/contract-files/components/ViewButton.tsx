// CR-149 · nút «Xem» + hộp xem chung (ảnh / PDF / Word); tách khỏi ContractFilesPanel để bảng ký dùng chung.
import { Button } from "@ai/web-kit/ui/kit/button";
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { sizeLabel } from "../lib/files-view";

// Hộp xem nạp lười: chỉ tải khi bấm «Xem» lần đầu (giữ chunk chi tiết HĐ trong ngân sách).
const FileViewerDialog = lazy(() =>
  import("~/components/shared/file-viewer/FileViewerDialog").then((m) => ({
    default: m.FileViewerDialog,
  })),
);

/** CR-149 · nút «Xem» + hộp xem chung (ảnh / PDF / Word; loại khác ⇒ tên + «Tải về» trong hộp). */
export function ViewButton({
  f,
  cacheKey,
  load,
}: {
  f: { name: string; mime: string; size: number; added_at: string };
  cacheKey: readonly unknown[];
  load: (signal: AbortSignal) => Promise<Blob>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" data-testid="cfile-view" onClick={() => setOpen(true)}>
        {t("contracts.cfiles.view")}
      </Button>
      {open && (
        <Suspense fallback={null}>
          <FileViewerDialog
            open={open}
            onClose={() => setOpen(false)}
            name={f.name}
            mime={f.mime}
            size={sizeLabel(f.size)}
            uploadedAt={f.added_at}
            cacheKey={cacheKey}
            load={load}
          />
        </Suspense>
      )}
    </>
  );
}
