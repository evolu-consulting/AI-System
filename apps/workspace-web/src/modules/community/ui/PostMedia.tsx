// CR-129/164 · phần media của bài: dùng bộ hiển thị chung (lưới ảnh 1/2/3/≥4 + thẻ tệp). Ảnh cần Bearer ⇒ `api.fileObjectUrl`.
import type { MediaItem } from "@ai/contracts/community";
import { AttachGallery } from "@ai/web-kit/ui/AttachGallery";
import { useMemo } from "react";
import { useApp } from "../application/ctx";
import { numLocale } from "../i18n";
import { attachLabels, toAttachItem } from "./attachView";

type Props = { media: MediaItem[]; onDownload: (fileId: string, name: string) => void };

export function PostMedia({ media, onDownload }: Props) {
  const { api } = useApp();
  const items = useMemo(() => media.map(toAttachItem), [media]);
  return (
    <AttachGallery
      items={items}
      getUrl={api.fileObjectUrl}
      onDownload={(a) => onDownload(a.id, a.name)}
      labels={attachLabels()}
      locale={numLocale()}
    />
  );
}
