// CR-164 · hiển thị ảnh + tệp đính kèm DÙNG CHUNG (Community, Chat, trò chuyện công ty): lưới ảnh 1/2/3/≥4 (+N), bấm ⇒ phóng to
// qua lại; thẻ tệp xếp dọc (icon theo loại, tên cắt giữa, dung lượng, «Tải»; PDF thêm «Xem» trong trang).
// Nguồn ảnh qua `getUrl(id)` (mỗi app tự lấy blob URL có xác thực); component tự thu hồi blob. Chữ qua `labels`.
import { ChevronLeft, ChevronRight, ImageOff, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { type CSSProperties, useEffect, useState } from "react";
import {
  type AttachItem,
  type AttachLabels,
  formatBytes,
  imageLayout,
  isPdfItem,
  splitAttachments,
  stepIndex,
  truncateMiddle,
} from "../attach-layout";
import {
  cardStyle,
  DownloadIcon,
  iconBtn,
  KindIcon,
  mix,
  SpinIcon,
  useLazyUrl,
  useVisible,
} from "./attach-parts";

export type AttachGalleryProps = {
  items: readonly AttachItem[];
  getUrl: (id: string) => Promise<string>;
  onDownload: (item: AttachItem) => void;
  labels: AttachLabels;
  locale?: string;
  /** Nhãn danh sách thẻ tệp (a11y). */
  ariaLabel?: string;
};

const GRID: Record<string, CSSProperties> = {
  two: { gridTemplateColumns: "1fr 1fr", height: 200 },
  three: { gridTemplateColumns: "2fr 1fr", gridTemplateRows: "1fr 1fr", height: 280 },
  four: { gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", height: 280 },
};

function Thumb({
  item,
  extra,
  big,
  style,
  getUrl,
  labels,
  onOpen,
}: {
  item: AttachItem;
  extra: number;
  big: boolean;
  style?: CSSProperties;
  getUrl: AttachGalleryProps["getUrl"];
  labels: AttachLabels;
  onOpen: () => void;
}) {
  const { ref, seen } = useVisible<HTMLButtonElement>();
  const { url, failed } = useLazyUrl(getUrl, item.id, seen);
  return (
    <button
      ref={ref}
      type="button"
      data-testid="post-image"
      aria-label={labels.openImage(item.name)}
      onClick={onOpen}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        border: 0,
        overflow: "hidden",
        borderRadius: 10,
        background: mix(8),
        color: "inherit",
        cursor: "zoom-in",
        minHeight: big ? 120 : 0,
        minWidth: 0,
        ...style,
      }}
    >
      {url ? (
        <img
          src={url}
          alt=""
          style={
            big
              ? {
                  display: "block",
                  maxWidth: "100%",
                  maxHeight: 360,
                  width: "auto",
                  height: "auto",
                }
              : { width: "100%", height: "100%", objectFit: "cover", display: "block" }
          }
        />
      ) : failed ? (
        <ImageOff size={24} aria-label={labels.failed} />
      ) : (
        <SpinIcon size={22} aria-hidden="true" />
      )}
      {extra > 0 && (
        <b
          data-testid="image-more"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgb(0 0 0 / 0.55)",
            color: "white",
            fontSize: 24,
          }}
        >
          +{extra}
        </b>
      )}
    </button>
  );
}

export function ImageGrid({
  images,
  getUrl,
  labels,
  onOpen,
}: {
  images: readonly AttachItem[];
  getUrl: AttachGalleryProps["getUrl"];
  labels: AttachLabels;
  onOpen: (i: number) => void;
}) {
  const { variant, shown, extra } = imageLayout(images.length);
  if (variant === "none") return null;
  const big = variant === "one";
  return (
    <div
      data-testid="image-grid"
      data-layout={variant}
      style={{
        display: big ? "flex" : "grid",
        gap: 8,
        maxWidth: big ? 420 : 480,
        ...GRID[variant],
      }}
    >
      {images.slice(0, shown).map((m, i) => (
        <Thumb
          key={m.id}
          item={m}
          big={big}
          extra={i === shown - 1 ? extra : 0}
          style={variant === "three" && i === 0 ? { gridRow: "1 / span 2" } : undefined}
          getUrl={getUrl}
          labels={labels}
          onOpen={() => onOpen(i)}
        />
      ))}
    </div>
  );
}

export function FileCard({
  item,
  labels,
  locale,
  onDownload,
  onView,
}: {
  item: AttachItem;
  labels: AttachLabels;
  locale?: string;
  onDownload: (a: AttachItem) => void;
  onView?: (a: AttachItem) => void;
}) {
  const off = item.disabled === true;
  return (
    <li
      data-testid="file-card"
      title={off ? labels.unavailable : item.name}
      aria-disabled={off ? true : undefined}
      style={{ ...cardStyle, listStyle: "none", opacity: off ? 0.55 : 1 }}
    >
      <KindIcon mime={item.mime} name={item.name} />
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <span className="fname" style={{ fontWeight: 600, overflowWrap: "anywhere" }}>
          {truncateMiddle(item.name)}
        </span>
        {item.size !== undefined && (
          <span style={{ opacity: 0.7, fontSize: 12 }}>{formatBytes(item.size, locale)}</span>
        )}
      </span>
      {!off && onView && isPdfItem(item) && (
        <button type="button" data-testid="file-view" style={iconBtn} onClick={() => onView(item)}>
          {labels.view}
        </button>
      )}
      {!off && (
        <button
          type="button"
          data-testid="file-download"
          style={iconBtn}
          aria-label={labels.downloadOf(item.name)}
          title={labels.download}
          onClick={() => onDownload(item)}
        >
          <DownloadIcon size={16} aria-hidden="true" />
        </button>
      )}
    </li>
  );
}

const navBtn: CSSProperties = {
  ...iconBtn,
  padding: 8,
  color: "white",
  border: 0,
  background: "rgb(255 255 255 / 0.15)",
};

/** Hộp phóng to: ảnh (qua lại ←/→) hoặc PDF trong khung. */
function Viewer({
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
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {url && pdf ? (
                <iframe
                  title={cur.name}
                  src={url}
                  style={{ width: "100%", height: "100%", border: 0, background: "white" }}
                />
              ) : url ? (
                <img
                  src={url}
                  alt={cur.name}
                  style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                />
              ) : (
                <span>{failed ? labels.failed : "…"}</span>
              )}
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

export function AttachGallery(props: AttachGalleryProps) {
  const { items, getUrl, labels, locale, onDownload, ariaLabel } = props;
  const { images, files } = splitAttachments(items);
  // Đang xem: danh sách + vị trí. Ảnh ⇒ qua lại giữa ảnh; PDF ⇒ một tệp.
  const [view, setView] = useState<{ list: readonly AttachItem[]; index: number } | null>(null);
  if (images.length === 0 && files.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <ImageGrid
        images={images}
        getUrl={getUrl}
        labels={labels}
        onOpen={(i) => setView({ list: images, index: i })}
      />
      {files.length > 0 && (
        <ul
          aria-label={ariaLabel}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            margin: 0,
            padding: 0,
            maxWidth: 420,
          }}
        >
          {files.map((f) => (
            <FileCard
              key={f.id}
              item={f}
              labels={labels}
              locale={locale}
              onDownload={onDownload}
              onView={(a) => setView({ list: [a], index: 0 })}
            />
          ))}
        </ul>
      )}
      {view && (
        <Viewer
          list={view.list}
          index={view.index}
          onIndex={(i) => setView({ ...view, index: i })}
          onClose={() => setView(null)}
          props={props}
        />
      )}
    </div>
  );
}
