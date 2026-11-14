// CR-147 · sửa bài: thêm / bớt tệp đính kèm (cùng luật tải lên như ô đăng: server quét MIME, cỡ, hạn mức).
// Chỉ trình bày + gọi `uploadFiles`; danh sách thuộc về form cha.
import type { MediaItem } from "@ai/contracts/community";
import { useRef, useState } from "react";
import { uploadFiles } from "../application/attach";
import { useApp } from "../application/ctx";
import { formatSize } from "../domain/media";
import { numLocale, t } from "../i18n";
import { IconAttach, IconX } from "./icons";

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
      {media.length > 0 && (
        <div className="attachrow">
          {media.map((m) => (
            <span className="attach" key={m.id} data-testid="edit-attach-item">
              {m.label}
              {m.size !== undefined && <i className="fsize">{formatSize(m.size, numLocale())}</i>}
              <button
                type="button"
                aria-label={t("community.composer.removeAttachment")}
                onClick={() => onChange(media.filter((x) => x.id !== m.id))}
              >
                <IconX size={14} />
              </button>
            </span>
          ))}
        </div>
      )}
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
