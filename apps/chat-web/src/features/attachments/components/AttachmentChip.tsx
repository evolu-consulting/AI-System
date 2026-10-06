// HUB-FR-44 · chip tệp đang chọn: đang tải / sẵn sàng / lỗi (+ Thử lại) / xoá.
import { AlertCircle, Loader2, Paperclip, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/utils";
import { formatSize } from "../lib/download";
import type { Chip } from "../lib/queue";

type Props = { chip: Chip; onRemove(): void; onRetry(): void };

function ChipStatus({ chip }: { chip: Chip }) {
  const { t } = useTranslation();
  if (chip.status === "error") return <span>{chip.errorKey ? t(chip.errorKey) : null}</span>;
  if (chip.status === "ready") return <span>{formatSize(chip.file.size)}</span>;
  return <span>{t("attach.uploading")}</span>;
}

export function AttachmentChip({ chip, onRemove, onRetry }: Props) {
  const { t } = useTranslation();
  const failed = chip.status === "error";
  const Icon = failed ? AlertCircle : chip.status === "ready" ? Paperclip : Loader2;
  return (
    <li
      className={cn(
        "flex max-w-full items-center gap-2 rounded-lg border px-2 py-1 text-xs",
        failed
          ? "border-destructive/30 bg-destructive/5 text-destructive"
          : "border-border bg-muted text-foreground",
      )}
    >
      <Icon
        className={cn("size-3.5 shrink-0", chip.status === "uploading" && "animate-spin")}
        aria-hidden="true"
      />
      <span className="min-w-0 truncate font-medium">{chip.file.name}</span>
      <ChipStatus chip={chip} />
      {chip.retryable && (
        <button type="button" className="underline" onClick={onRetry}>
          {t("attach.retry")}
        </button>
      )}
      <button
        type="button"
        className="rounded-sm p-0.5 hover:bg-foreground/10"
        aria-label={t("attach.remove", { filename: chip.file.name })}
        onClick={onRemove}
      >
        <X className="size-3" aria-hidden="true" />
      </button>
    </li>
  );
}

export function AttachBar({
  chips,
  onRemove,
  onRetry,
}: {
  chips: readonly Chip[];
  onRemove(uid: number): void;
  onRetry(uid: number): void;
}) {
  const { t } = useTranslation();
  if (chips.length === 0) return null;
  return (
    <ul aria-label={t("attach.list")} className="mb-2 flex flex-wrap gap-2">
      {chips.map((c) => (
        <AttachmentChip
          key={c.uid}
          chip={c}
          onRemove={() => onRemove(c.uid)}
          onRetry={() => onRetry(c.uid)}
        />
      ))}
    </ul>
  );
}
