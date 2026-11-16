// CR-179 · trình xem ảnh/PDF của AttachGallery: hộp nền đen kích thước cố định (ViewerStage), «Đang tải…» tới khi blob sẵn sàng.
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect } from "react";
import { type AttachItem, isPdfItem, stepIndex } from "../attach-layout";
import type { AttachGalleryProps } from "./AttachGallery";
import { ViewerStage } from "./attach-frame";
import { DownloadIcon, navBtn, useLazyUrl } from "./attach-parts";

export function AttachViewer({
  list,
  index,
  onIndex,
  onClose,
  props,
}: {
  list: readonly AttachItem[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  props: AttachGalleryProps;
}) {
  const cur = list[index];
  const n = list.length;
  const { url, failed } = useLazyUrl(props.getUrl, cur?.id ?? "", cur !== undefined);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") onIndex(stepIndex(index, -1, n));
      else if (e.key === "ArrowRight") onIndex(stepIndex(index, 1, n));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, n, onIndex]);
  if (!cur) return null;
  const pdf = isPdfItem(cur);
  const { labels } = props;
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          style={{ position: "fixed", inset: 0, background: "rgb(0 0 0 / 0.8)", zIndex: 1000 }}
        />
        <Dialog.Content
          data-testid="image-viewer"
          aria-describedby={undefined}
          style={{
            position: "fixed",
            inset: "4vh 4vw",
            zIndex: 1001,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            color: "white",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Dialog.Title
              style={{ flex: 1, minWidth: 0, margin: 0, fontSize: 15, overflowWrap: "anywhere" }}
            >
              {cur.name}
            </Dialog.Title>
            <span className="tnum" style={{ opacity: 0.8 }}>
              {index + 1} / {n}
            </span>
            <button type="button" style={navBtn} onClick={() => props.onDownload(cur)}>
              <DownloadIcon size={16} aria-hidden="true" /> {labels.download}
            </button>
            <Dialog.Close style={navBtn} aria-label={labels.close}>
              <X size={16} aria-hidden="true" />
            </Dialog.Close>
          </div>
          <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", gap: 8 }}>
            {n > 1 && (
              <button
                type="button"
                style={navBtn}
                aria-label={labels.prev}
                onClick={() => onIndex(stepIndex(index, -1, n))}
              >
                <ChevronLeft size={22} aria-hidden="true" />
              </button>
            )}
            <div
              style={{
                flex: 1,
                minWidth: 0,
                height: "100%",
                display: "grid",
                placeItems: "center",
              }}
            >
              <ViewerStage loading={!url && !failed} loadingText={labels.loading ?? "…"}>
                {failed || !url ? (
                  <span>{labels.failed}</span>
                ) : pdf ? (
                  <iframe
                    title={cur.name}
                    src={url}
                    style={{ width: "100%", height: "100%", border: 0, background: "white" }}
                  />
                ) : (
                  <img
                    src={url}
                    alt={cur.name}
                    decoding="async"
                    style={{ width: "100%", height: "100%", objectFit: "contain" }}
                  />
                )}
              </ViewerStage>
            </div>
            {n > 1 && (
              <button
                type="button"
                style={navBtn}
                aria-label={labels.next}
                onClick={() => onIndex(stepIndex(index, 1, n))}
              >
                <ChevronRight size={22} aria-hidden="true" />
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
