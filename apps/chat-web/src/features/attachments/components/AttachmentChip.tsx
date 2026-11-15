// HUB-FR-44 · CR-164 · tệp đang chọn lúc soạn: bộ chung (ảnh thu nhỏ / thẻ tệp, ✕ bỏ, thanh tải lên, Thử lại khi lỗi).
import { AttachDraftList } from "@ai/web-kit/ui/AttachDraft";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { attachLabels, toDraftItem } from "../lib/attachView";
import type { Chip } from "../lib/queue";

export function AttachBar({
  chips,
  onRemove,
  onRetry,
}: {
  chips: readonly Chip[];
  onRemove(uid: number): void;
  onRetry(uid: number): void;
}) {
  const { t, i18n } = useTranslation();
  const items = useMemo(() => chips.map((c) => toDraftItem(c, t)), [chips, t]);
  if (chips.length === 0) return null;
  return (
    <div className="mb-2">
      <AttachDraftList
        items={items}
        ariaLabel={t("attach.list")}
        labels={attachLabels(t)}
        locale={i18n.language}
        onRemove={(id) => onRemove(Number(id))}
        onRetry={(id) => onRetry(Number(id))}
      />
    </div>
  );
}
