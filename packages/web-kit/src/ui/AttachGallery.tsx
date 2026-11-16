import { type CSSProperties, useState } from "react";
import {
  ATTACH_SIZE,
  type AttachItem,
  type AttachLabels,
  formatBytes,
  imageLayout,
  isPdfItem,
  splitAttachments,
  thumbFrame,
  truncateMiddle,
} from "../attach-layout";
import { AttachViewer } from "./AttachViewer";
import { FramedImage } from "./attach-frame";
import type { AttachGalleryProps } from "./attach-gallery-props";
import {
  cardStyle,
  DownloadIcon,
  iconBtn,
  KindIcon,
  mix,
  useLazyUrl,
  useVisible,
} from "./attach-parts";

export type { AttachGalleryProps } from "./attach-gallery-props";

const GRID: Record<string, CSSProperties> = {
  two: { gridTemplateColumns: "1fr 1fr", height: ATTACH_SIZE.gridTwoHeight },
  three: {
    gridTemplateColumns: "2fr 1fr",
    gridTemplateRows: "1fr 1fr",
    height: ATTACH_SIZE.gridManyHeight,
  },
  four: {
    gridTemplateColumns: "1fr 1fr",
    gridTemplateRows: "1fr 1fr",
    height: ATTACH_SIZE.gridManyHeight,
  },
};

function Thumb({
  item,
  extra,
  big,
  style,
  getUrl,
  labels,
  onOpen,
  onDownload,
}: {
  item: AttachItem;
  extra: number;
  big: boolean;
  style?: CSSProperties;
  getUrl: AttachGalleryProps["getUrl"];
  labels: AttachLabels;
  onOpen: () => void;
  onDownload?: () => void;
}) {
  const { ref, seen } = useVisible<HTMLDivElement>();
  const { url, failed } = useLazyUrl(getUrl, item.id, seen);
  return (
    <div
      ref={ref}
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 10,
        background: mix(8),
        minWidth: 0,
        ...thumbFrame(big),
        ...style,
      }}
    >
      <button
        type="button"
        data-testid="post-image"
        aria-label={labels.openImage(item.name)}
        onClick={onOpen}
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          border: 0,
          background: "transparent",
          color: "inherit",
          cursor: "zoom-in",
        }}
      >
        <FramedImage url={url} failed={failed} alt="" fit="cover" labels={labels} />
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
      {failed && onDownload && (
        <button
          type="button"
          data-testid="thumb-download"
          style={{
            ...iconBtn,
            position: "absolute",
            left: "50%",
            bottom: 8,
            transform: "translateX(-50%)",
            fontSize: 12,
          }}
          onClick={onDownload}
        >
          <DownloadIcon size={14} aria-hidden="true" /> {labels.download}
        </button>
      )}
    </div>
  );
}

export function ImageGrid({
  images,
  getUrl,
  labels,
  onOpen,
  onDownload,
  center,
}: {
  images: readonly AttachItem[];
  getUrl: AttachGalleryProps["getUrl"];
  labels: AttachLabels;
  onOpen: (i: number) => void;
  onDownload?: (item: AttachItem) => void;
  center?: boolean;
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
        // CR-179 sửa: rộng CỐ ĐỊNH bằng px (không `100%`) — trong bong bóng chat (co theo nội dung) `100%` + ảnh absolute ⇒ khung 0×0, ảnh biến mất.
        width: big ? ATTACH_SIZE.oneMaxWidth : ATTACH_SIZE.gridMaxWidth,
        maxWidth: "100%",
        ...(center ? { marginInline: "auto", justifyContent: "center" } : null),
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
          onDownload={onDownload ? () => onDownload(m) : undefined}
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
    // button-gap-ok: khoảng cách nằm trong `cardStyle` (gap: 8, attach-parts.tsx)
    <li
      data-testid="file-card"
      title={off ? labels.unavailable : item.name}
      aria-disabled={off ? true : undefined}
      style={{
        ...cardStyle,
        listStyle: "none",
        opacity: off ? 0.55 : 1,
        height: ATTACH_SIZE.cardHeight,
        boxSizing: "border-box",
      }}
    >
      <KindIcon mime={item.mime} name={item.name} />
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <span
          className="fname"
          style={{
            fontWeight: 600,
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
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

export function AttachGallery(props: AttachGalleryProps) {
  const { items, getUrl, labels, locale, onDownload, ariaLabel, align } = props;
  const center = align === "center";
  const { images, files } = splitAttachments(items);
  const [view, setView] = useState<{ list: readonly AttachItem[]; index: number } | null>(null);
  if (images.length === 0 && files.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <ImageGrid
        images={images}
        getUrl={getUrl}
        labels={labels}
        onOpen={(i) => setView({ list: images, index: i })}
        onDownload={onDownload}
        center={center}
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
            width: ATTACH_SIZE.cardMaxWidth,
            maxWidth: "100%",
            ...(center ? { marginInline: "auto" } : null),
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
        <AttachViewer
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
