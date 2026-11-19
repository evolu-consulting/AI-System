// CR-138 Q9 · «Ảnh bìa công ty» ở Cài đặt › Công ty cạnh logo (cùng khuôn với logo): PNG/JPG/WebP ≤ 3 MB, gợi ý tỉ lệ 4:1, chỉ chủ sở hữu.
// Lưu cùng nút Lưu chung (thân PUT `/company`: vắng = giữ, ảnh = thay, null = xoá). Chưa có ảnh ⇒ ô mẫu nền màu chủ đạo (như hồ sơ Bảng tin).
import { toast } from "@ai/web-kit/ui/toast";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Btn } from "~/components/ui/Btn";
import { ImageCropDialog } from "~/shared/image-crop/ImageCropDialog";
import { IMAGE_TYPES, SOURCE_MAX_BYTES } from "~/shared/image-crop/image";
import { cropDataUrl, decodeSource, type Source } from "~/shared/image-crop/image-file";
import { useCompanyCover } from "../hooks/use-settings";
import { accentGradient } from "../lib/brand";
import { coverShown } from "../lib/data";
import type { CompanyDraft } from "../lib/types";

export function CoverField({
  value: c,
  set,
}: {
  value: CompanyDraft;
  set: (c: CompanyDraft) => void;
}) {
  const { t } = useTranslation();
  const s = (k: string) => t(`contracts.settings.co.${k}`);
  const file = useRef<HTMLInputElement>(null);
  const [src, setSrc] = useState<Source | null>(null);
  const [busy, setBusy] = useState(false);
  const saved = useCompanyCover(c.has_cover && c.cover === undefined);
  const shown = coverShown(c, saved.data?.cover);
  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!(IMAGE_TYPES as readonly string[]).includes(f.type)) return toast(s("coverType"), "late");
    if (f.size > SOURCE_MAX_BYTES) return toast(s("coverBig"), "late");
    // CR-192: mở hộp cắt 3:1; máy thu nhỏ 1200×400 ≤ 400 KB khi bấm «Lưu ảnh»
    decodeSource(f).then(setSrc, () => toast(s("coverFail"), "late"));
  };
  const closeCrop = () => {
    src?.release();
    setSrc(null);
  };
  return (
    <div className="flex flex-col gap-2">
      <div
        data-testid="cover-preview"
        className="h-20 w-full max-w-xl overflow-hidden rounded-lg border border-rule"
        style={shown ? undefined : { background: accentGradient(c.accent) }}
      >
        {shown && <img src={shown} alt={s("coverAlt")} className="h-full w-full object-cover" />}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={file}
          type="file"
          hidden
          accept={IMAGE_TYPES.join(",")}
          data-testid="cover-file"
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Btn variant="outline" size="sm" onClick={() => file.current?.click()}>
          {shown ? s("coverChange") : s("coverUpload")}
        </Btn>
        {shown && (
          <Btn size="sm" variant="quiet" onClick={() => set({ ...c, cover: null })}>
            {s("coverRemove")}
          </Btn>
        )}
        <p className="basis-full text-caption text-dim">{s("coverHint")}</p>
      </div>
      {src && (
        <ImageCropDialog
          kind="cover"
          src={src}
          busy={busy}
          labels={{
            title: s("cropTitle"),
            drag: s("cropDrag"),
            zoom: s("cropZoom"),
            cancel: s("cropCancel"),
            save: s("cropSave"),
          }}
          onCancel={closeCrop}
          onConfirm={(rect) => {
            setBusy(true);
            cropDataUrl(src, rect, "cover")
              .then((u) => {
                set({ ...c, cover: u });
                closeCrop();
              })
              .catch(() => toast(s("coverFail"), "late"))
              .finally(() => setBusy(false));
          }}
        />
      )}
    </div>
  );
}
