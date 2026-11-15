// CR-147 · sửa bài: thêm / bớt tệp đính kèm (cùng luật tải lên như ô đăng: server quét MIME, cỡ, hạn mức).
// Chỉ trình bày + gọi `uploadFiles`; danh sách thuộc về form cha.
import type { MediaItem } from "@ai/contracts/community";
import { attachPickLabels } from "@ai/web-kit/attach-layout";
import { AttachPickButton } from "@ai/web-kit/ui/AttachDropzone";
import { useState } from "react";
import { uploadFiles } from "../application/attach";
import { useApp } from "../application/ctx";
import { t } from "../i18n";
import { DraftAttachments } from "./DraftAttachments";

export function AttachEditor({
  media,
  onChange,
}: {
  media: MediaItem[];
  onChange: (m: MediaItem[]) => void;
}) {
  const { api, toast } = useApp();
  const [uploading, setUploading] = useState(false);
  const add = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const r = await uploadFiles(api, files, media);
      for (const n of r.notices)
        toast(t(n.key, n.params) + (n.retry ? ` ${t(n.retry.key, n.retry.params)}` : ""));
      onChange(r.media);
    } finally {
      setUploading(false);
    }
  };
  return (
    <div data-testid="edit-attach">
      <DraftAttachments media={media} busy={uploading} onChange={onChange} />
      <AttachPickButton
        labels={attachPickLabels(t, "community.composer.attachPick")}
        check={false}
        className="ghost icononly"
        testId="edit-attach-btn"
        inputTestId="edit-attach-input"
        disabled={uploading}
        onFiles={(files) => void add(files)}
      />
    </div>
  );
}
