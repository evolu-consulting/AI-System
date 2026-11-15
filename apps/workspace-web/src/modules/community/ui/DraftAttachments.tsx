// CR-164 · tệp đính kèm lúc soạn/sửa bài: ảnh thu nhỏ + thẻ tệp, nút ✕ bỏ, thanh tải lên (bộ chung `@ai/web-kit`).
import type { MediaItem } from "@ai/contracts/community";
import { AttachDraftList } from "@ai/web-kit/ui/AttachDraft";
import { useMemo } from "react";
import { useApp } from "../application/ctx";
import { numLocale } from "../i18n";
import { attachLabels, toDraftItem } from "./attachView";

export function DraftAttachments({
  media,
  busy,
  onChange,
}: {
  media: MediaItem[];
  busy: boolean;
  onChange: (m: MediaItem[]) => void;
}) {
  const { api } = useApp();
  const items = useMemo(() => media.map(toDraftItem), [media]);
  return (
    <AttachDraftList
      items={items}
      busy={busy}
      labels={attachLabels()}
      getUrl={api.fileObjectUrl}
      locale={numLocale()}
      onRemove={(id) => onChange(media.filter((x) => x.id !== id))}
    />
  );
}
