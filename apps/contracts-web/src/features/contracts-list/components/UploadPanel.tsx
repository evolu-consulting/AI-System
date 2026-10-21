// Gap #9 · vùng kéo-thả + bảng tiến độ từng tệp. `DropOverlay` bọc cả trang: kéo tệp vào bất cứ đâu ⇒ hiện lớp phủ "Thả để tải lên".
import { Link } from "@tanstack/react-router";
import { type DragEvent, type ReactNode, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { sizeText, type UploadItem } from "../lib/upload-queue";

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

export function DropOverlay({
  enabled,
  onFiles,
  children,
  className,
}: {
  enabled: boolean;
  onFiles: (f: File[]) => void;
  children: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const [over, setOver] = useState(false);
  const depth = useRef(0); // dragenter/leave nổi bọt từ con ⇒ đếm độ sâu
  if (!enabled) return <div className={className}>{children}</div>;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: kéo-thả tệp là thao tác bổ sung; đường bàn phím là nút "Upload hợp đồng"
    <div
      className={`relative ${className ?? ""}`}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        depth.current++;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (hasFiles(e)) e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setOver(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        onFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {children}
      {over && (
        <div
          data-testid="drop-overlay"
          className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-act bg-panel/90 text-base font-semibold text-act"
        >
          {t("contracts.list.upload.drop")}
        </div>
      )}
    </div>
  );
}

const TONE: Record<UploadItem["state"], string> = {
  queued: "text-dim",
  uploading: "text-act",
  done: "text-ok",
  error: "text-late",
};

function Row({ item, onRetry }: { item: UploadItem; onRetry: (key: number) => void }) {
  const { t } = useTranslation();
  const w =
    item.state === "done" || item.state === "error"
      ? "100%"
      : item.state === "uploading"
        ? "60%"
        : "0%";
  return (
    <li className="px-4 py-2" data-state={item.state}>
      <div className="flex items-center gap-3 text-[13px]">
        <span className="min-w-0 flex-1 truncate" title={item.name}>
          {item.name} <span className="text-dim">· {sizeText(item.size)}</span>
        </span>
        <span className={`shrink-0 font-medium ${TONE[item.state]}`}>
          {t(`contracts.list.upload.state.${item.state}`)}
        </span>
        {item.state === "done" && item.id && (
          <Link
            to="/contracts/$id"
            params={{ id: item.id }}
            className="shrink-0 text-act hover:underline"
          >
            {t("contracts.list.view")}
          </Link>
        )}
        {item.state === "error" && item.retryable && (
          <button
            type="button"
            className="shrink-0 text-act hover:underline"
            onClick={() => onRetry(item.key)}
          >
            {t("contracts.list.upload.retry")}
          </button>
        )}
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={item.state === "uploading" ? undefined : item.state === "queued" ? 0 : 100}
        aria-label={item.name}
        className="mt-1 h-1 overflow-hidden rounded-full bg-sunk"
      >
        <div
          className={`h-full rounded-full transition-[width] ${item.state === "error" ? "bg-late" : "bg-act"} ${item.state === "uploading" ? "animate-pulse" : ""}`}
          style={{ width: w }}
        />
      </div>
      {item.state === "error" && item.error && (
        <p role="alert" className="mt-1 text-[12.5px] text-late">
          {item.error}
        </p>
      )}
    </li>
  );
}

export function UploadPanel({
  items,
  onRetry,
  onClose,
}: {
  items: UploadItem[];
  onRetry: (key: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (!items.length) return null;
  const finished = items.filter((i) => i.state === "done" || i.state === "error").length;
  const busy = finished < items.length;
  return (
    <section
      aria-label={t("contracts.list.upload.title")}
      className="mb-4 rounded-xl border border-rule-soft bg-panel"
    >
      <header className="flex items-center gap-3 border-b border-rule-soft px-4 py-2.5 text-[13.5px]">
        <strong className="font-semibold">
          {t("contracts.list.upload.title")} · {finished}/{items.length}
        </strong>
        <button
          type="button"
          disabled={busy}
          className="ml-auto text-act hover:underline disabled:cursor-not-allowed disabled:text-dim disabled:no-underline"
          onClick={onClose}
        >
          {t("contracts.list.upload.close")}
        </button>
      </header>
      <ul className="max-h-72 divide-y divide-rule-soft overflow-auto">
        {items.map((i) => (
          <Row key={i.key} item={i} onRetry={onRetry} />
        ))}
      </ul>
    </section>
  );
}
