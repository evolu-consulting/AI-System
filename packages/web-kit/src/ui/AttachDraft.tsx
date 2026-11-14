// CR-164 · tệp đính kèm LÚC SOẠN (dùng chung): ảnh ⇒ ô thu nhỏ, tệp khác ⇒ thẻ; mỗi mục có nút ✕ bỏ; đang tải ⇒ thanh tiến trình
// (`progress` 0..1 nếu biết, không thì chạy vô định). Ảnh xem trước lấy từ `file` (cục bộ) hoặc `getUrl(id)` (đã lên server).
import { AlertCircle, X } from "lucide-react";
import { type CSSProperties, useEffect, useState } from "react";
import { type AttachLabels, fileKind, formatBytes, truncateMiddle } from "../attach-layout";
import { cardStyle, iconBtn, KindIcon, mix, useLazyUrl } from "./attach-parts";

export type DraftItem = {
  id: string;
  name: string;
  mime: string;
  size?: number;
  /** Tệp cục bộ (chưa/đang lên server): ảnh xem trước từ đây, không gọi mạng. */
  file?: File;
  status: "uploading" | "ready" | "error";
  /** 0..1; vắng ⇒ thanh chạy vô định. */
  progress?: number;
  errorText?: string;
  retryable?: boolean;
};

type Props = {
  items: readonly DraftItem[];
  labels: AttachLabels;
  onRemove: (id: string) => void;
  onRetry?: (id: string) => void;
  /** Ảnh đã lên server không có `file` ⇒ lấy qua đây. */
  getUrl?: (id: string) => Promise<string>;
  locale?: string;
  ariaLabel?: string;
  /** Đang tải lên mà chưa có mục (vd tải lần lượt): hiện một thanh chạy. */
  busy?: boolean;
};

const KEYFRAMES =
  "@keyframes attach-bar{0%{margin-left:-40%}100%{margin-left:100%}}@keyframes attach-spin{to{transform:rotate(360deg)}}";

function Bar({ value, label }: { value?: number; label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === undefined ? undefined : Math.round(value * 100)}
      data-testid="upload-progress"
      style={{ height: 4, borderRadius: 2, overflow: "hidden", background: mix(15), minWidth: 40 }}
    >
      <div
        style={{
          height: "100%",
          width: value === undefined ? "40%" : `${Math.round(value * 100)}%`,
          background: "var(--brand, currentColor)",
          animation: value === undefined ? "attach-bar 1.1s ease-in-out infinite" : undefined,
        }}
      />
    </div>
  );
}

/** URL xem trước cục bộ từ `File`, thu hồi khi gỡ. */
function useFileUrl(file: File | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url;
}

const xStyle: CSSProperties = { ...iconBtn, padding: 2, borderRadius: 999 };

function RemoveBtn({
  item,
  labels,
  onRemove,
  floating,
}: {
  item: DraftItem;
  labels: AttachLabels;
  onRemove: Props["onRemove"];
  floating?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid="draft-remove"
      aria-label={labels.remove(item.name)}
      title={labels.remove(item.name)}
      onClick={() => onRemove(item.id)}
      style={
        floating
          ? {
              ...xStyle,
              position: "absolute",
              top: 4,
              right: 4,
              background: "rgb(0 0 0 / 0.6)",
              color: "white",
              border: 0,
            }
          : xStyle
      }
    >
      <X size={14} aria-hidden="true" />
    </button>
  );
}

function ImageTile({ item, labels, onRemove, getUrl }: Omit<Props, "items"> & { item: DraftItem }) {
  const local = useFileUrl(item.file);
  const remote = useLazyUrl(
    getUrl ?? (() => Promise.reject(new Error("no source"))),
    item.id,
    !item.file && !!getUrl,
  );
  const url = local ?? remote.url;
  return (
    <li
      data-testid="draft-image"
      title={item.name}
      style={{
        position: "relative",
        listStyle: "none",
        width: 72,
        height: 72,
        borderRadius: 10,
        overflow: "hidden",
        background: mix(8),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {url ? (
        <img
          src={url}
          alt={item.name}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <KindIcon mime={item.mime} name={item.name} />
      )}
      {item.status === "uploading" && (
        <div style={{ position: "absolute", left: 6, right: 6, bottom: 6 }}>
          <Bar value={item.progress} label={labels.uploading} />
        </div>
      )}
      {item.status === "error" && (
        <AlertCircle
          size={18}
          aria-label={item.errorText ?? labels.failed}
          style={{ position: "absolute", left: 4, bottom: 4, color: "white" }}
        />
      )}
      <RemoveBtn item={item} labels={labels} onRemove={onRemove} floating />
    </li>
  );
}

function FileRow({
  item,
  labels,
  onRemove,
  onRetry,
  locale,
}: Omit<Props, "items"> & { item: DraftItem }) {
  const failed = item.status === "error";
  return (
    <li
      data-testid="draft-file"
      style={{
        ...cardStyle,
        listStyle: "none",
        borderColor: failed ? "currentColor" : undefined,
        width: 260,
      }}
    >
      <KindIcon mime={item.mime} name={item.name} size={20} />
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <span title={item.name} style={{ fontWeight: 600 }}>
          {truncateMiddle(item.name, 26)}
        </span>
        {item.status === "uploading" ? (
          <>
            <span style={{ opacity: 0.7, fontSize: 12 }}>{labels.uploading}</span>
            <Bar value={item.progress} label={labels.uploading} />
          </>
        ) : (
          <span style={{ opacity: 0.7, fontSize: 12 }}>
            {failed
              ? (item.errorText ?? labels.failed)
              : item.size !== undefined
                ? formatBytes(item.size, locale)
                : ""}
          </span>
        )}
      </span>
      {item.retryable && onRetry && (
        <button type="button" style={iconBtn} onClick={() => onRetry(item.id)}>
          {labels.retry}
        </button>
      )}
      <RemoveBtn item={item} labels={labels} onRemove={onRemove} />
    </li>
  );
}

export function AttachDraftList(props: Props) {
  const { items, ariaLabel, busy, labels } = props;
  if (items.length === 0 && !busy) return null;
  return (
    <ul
      aria-label={ariaLabel}
      data-testid="draft-list"
      style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: 0, padding: 0 }}
    >
      <style>{KEYFRAMES}</style>
      {busy && (
        <li style={{ ...cardStyle, listStyle: "none", width: 260 }}>
          <span style={{ flex: 1 }}>
            <Bar label={labels.uploading} />
          </span>
          <span style={{ opacity: 0.7, fontSize: 12 }}>{labels.uploading}</span>
        </li>
      )}
      {items.map((it) =>
        fileKind(it.mime, it.name) === "image" && it.status !== "error" ? (
          <ImageTile key={it.id} {...props} item={it} />
        ) : (
          <FileRow key={it.id} {...props} item={it} />
        ),
      )}
    </ul>
  );
}
