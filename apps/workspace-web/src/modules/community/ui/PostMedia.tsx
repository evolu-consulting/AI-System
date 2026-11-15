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
    // CR-166: lề đồng đều với chữ của bài (trái 19px như .pbody, phải 16px), khối ảnh căn giữa.
    <div data-testid="post-media" style={{ padding: "10px 16px 4px 19px" }}>
      <AttachGallery
        items={items}
        getUrl={api.fileObjectUrl}
        onDownload={(a) => onDownload(a.id, a.name)}
        labels={attachLabels()}
        locale={numLocale()}
        align="center"
      />
    </div>
  );
}
