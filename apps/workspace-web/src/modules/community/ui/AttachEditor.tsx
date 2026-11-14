// CR-147 · sửa bài: thêm / bớt tệp đính kèm (cùng luật tải lên như ô đăng: server quét MIME, cỡ, hạn mức).
// Chỉ trình bày + gọi `uploadFiles`; danh sách thuộc về form cha.
import type { MediaItem } from "@ai/contracts/community";
import { useRef, useState } from "react";
import { uploadFiles } from "../application/attach";
import { useApp } from "../application/ctx";
import { t } from "../i18n";
import { DraftAttachments } from "./DraftAttachments";
import { IconAttach } from "./icons";

export function AttachEditor({
  media,
  onChange,
}: {
  media: MediaItem[];
  onChange: (m: MediaItem[]) => void;
}) {
  const { api, toast } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const add = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const r = await uploadFiles(api, Array.from(files), media);
      for (const n of r.notices)
        toast(t(n.key, n.params) + (n.retry ? ` ${t(n.retry.key, n.retry.params)}` : ""));
      onChange(r.media);
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div data-testid="edit-attach">
      <DraftAttachments media={media} busy={uploading} onChange={onChange} />
      <input
        ref={input}
        type="file"
        multiple
        hidden
        data-testid="edit-attach-input"
        onChange={(e) => void add(e.target.files)}
      />
      <button
        type="button"
        className="ghost icononly"
        data-testid="edit-attach-btn"
        aria-label={t("community.composer.attach")}
        title={t("community.composer.attach")}
        disabled={uploading}
        onClick={() => input.current?.click()}
      >
        <IconAttach size={18} />
      </button>
    </div>
  );
}
