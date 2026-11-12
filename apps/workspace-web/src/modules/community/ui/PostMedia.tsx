// CR-129 · phần media của bài: ảnh ⇒ lưới thu nhỏ tối đa 3 ô (ô cuối «+N»), bấm ⇒ phóng to; tệp khác ⇒ thẻ tải về.
import type { MediaItem } from "@ai/contracts/community";
import { useEffect, useRef, useState } from "react";
import { formatSize, imageGrid, splitMedia } from "../domain/media";
import { numLocale, t } from "../i18n";
import { ImageViewer } from "./ImageViewer";
import { IconAttach, IconImage } from "./icons";
import { useImageUrl } from "./useImageUrl";

/** "Đã vào khung nhìn" một lần (IntersectionObserver) để tải ảnh lười. */
function useVisible() {
  const ref = useRef<HTMLButtonElement>(null);
  const [seen, setSeen] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (seen || !el) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setSeen(true), {
      rootMargin: "200px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return { ref, seen };
}

function Thumb({ item, extra, onOpen }: { item: MediaItem; extra: number; onOpen: () => void }) {
  const { ref, seen } = useVisible();
  const { url } = useImageUrl(item.fileId as string, seen);
  const name = item.name ?? item.label;
  return (
    <button
      ref={ref}
      type="button"
      className="mbox imgthumb"
      data-testid="post-image"
      aria-label={t("community.post.imageOpen", { name })}
      onClick={onOpen}
    >
      {url ? <img src={url} alt="" loading="lazy" /> : <IconImage size={26} />}
      {extra > 0 && (
        <b className="imgmore" data-testid="image-more">
          +{extra}
        </b>
      )}
    </button>
  );
}

function FileCard({ m, onDownload }: { m: MediaItem; onDownload: Props["onDownload"] }) {
  if (m.kind !== "file" || !m.fileId)
    return (
      <div className="mbox">
        <IconImage size={26} />
        <span>{m.label}</span>
      </div>
    );
  const fileId = m.fileId;
  return (
    <button
      type="button"
      className="mbox filecard"
      data-testid="file-card"
      title={t("community.post.download")}
      onClick={() => onDownload(fileId, m.name ?? m.label)}
    >
      <IconAttach size={22} />
      <span className="fname">{m.name ?? m.label}</span>
      {m.size !== undefined && <i className="fsize">{formatSize(m.size, numLocale())}</i>}
      <b className="fget">{t("community.post.download")}</b>
    </button>
  );
}

type Props = { media: MediaItem[]; onDownload: (fileId: string, name: string) => void };

export function PostMedia({ media, onDownload }: Props) {
  const { images, others } = splitMedia(media);
  const { shown, extra, cols } = imageGrid(images.length);
  const [viewing, setViewing] = useState<number | null>(null);
  return (
    <>
      {shown > 0 && (
        <div className={`media imggrid n${cols}`} data-testid="image-grid">
          {images.slice(0, shown).map((m, i) => (
            <Thumb
              key={m.id}
              item={m}
              extra={i === shown - 1 ? extra : 0}
              onOpen={() => setViewing(i)}
            />
          ))}
        </div>
      )}
      {others.length > 0 && (
        <div className="media n1">
          {others.map((m) => (
            <FileCard key={m.id} m={m} onDownload={onDownload} />
          ))}
        </div>
      )}
      {viewing !== null && (
        <ImageViewer
          images={images}
          index={viewing}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
          onDownload={onDownload}
        />
      )}
    </>
  );
}
