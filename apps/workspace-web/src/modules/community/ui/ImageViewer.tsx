// CR-129 · hộp phóng to ảnh bài đăng: qua lại giữa ảnh (nút + phím ←/→), Esc/nút Đóng, nút Tải về.
import type { MediaItem } from "@ai/contracts/community";
import { useEffect } from "react";
import { Dialog, DialogContent, DialogTitle } from "~/components/ui/dialog";
import { useApp } from "../application/ctx";
import { stepImage } from "../domain/media";
import { t } from "../i18n";
import { useImageUrl } from "./useImageUrl";

type Props = {
  images: MediaItem[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onDownload: (fileId: string, name: string) => void;
};

export function ImageViewer({ images, index, onIndex, onClose, onDownload }: Props) {
  const { brandAccent } = useApp();
  const cur = images[index];
  const { url, failed } = useImageUrl(cur?.fileId ?? "", cur !== undefined);
  const n = images.length;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") onIndex(stepImage(index, -1, n));
      else if (e.key === "ArrowRight") onIndex(stepImage(index, 1, n));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, n, onIndex]);
  if (!cur?.fileId) return null;
  const fileId = cur.fileId;
  const name = cur.name ?? cur.label;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="sm:max-w-[min(92vw,960px)]"
        data-testid="image-viewer"
        aria-describedby={undefined}
      >
        <div data-mod="community" data-accent={brandAccent}>
          <div className="imgviewer">
            <DialogTitle className="imgviewer-title">{name}</DialogTitle>
            <div className="imgviewer-stage">
              {n > 1 && (
                <button
                  type="button"
                  className="ghost icononly imgnav"
                  aria-label={t("community.post.imagePrev")}
                  onClick={() => onIndex(stepImage(index, -1, n))}
                >
                  ‹
                </button>
              )}
              {url ? (
                <img src={url} alt={name} />
              ) : (
                <span className="muted">{failed ? t("community.post.downloadFailed") : "…"}</span>
              )}
              {n > 1 && (
                <button
                  type="button"
                  className="ghost icononly imgnav"
                  aria-label={t("community.post.imageNext")}
                  onClick={() => onIndex(stepImage(index, 1, n))}
                >
                  ›
                </button>
              )}
            </div>
            <div className="imgviewer-bar">
              <span className="muted tnum">
                {index + 1} / {n}
              </span>
              <button type="button" className="ghost" onClick={() => onDownload(fileId, name)}>
                {t("community.post.download")}
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
