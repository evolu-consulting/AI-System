// CR-147b · nút chọn ảnh (avatar hoặc ảnh bìa) + nút xoá. Kiểm loại/dung lượng, báo lỗi bằng nhãn nghiệp vụ; lưu qua `onSave` (null = xoá).

import { useRef, useState } from "react";
import type { Rect } from "~/shared/image-crop/crop";
import { ImageCropDialog } from "~/shared/image-crop/ImageCropDialog";
import { checkImage, type ImageKind, maxBytesOf } from "~/shared/image-crop/image";
import { cropDataUrl, decodeSource, type Source } from "~/shared/image-crop/image-file";
import { IconButton } from "~/shared/ui/IconButton";
import { t } from "../../i18n";
import { IconEdit, IconTrash } from "../icons";

export function ImagePick({
  kind,
  hasImage,
  onSave,
  testId,
}: {
  kind: ImageKind;
  hasImage: boolean;
  onSave: (dataUrl: string | null) => Promise<void>;
  testId: string;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [src, setSrc] = useState<Source | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      // lỗi thật (message) ra console + hậu tố trong thông báo chung để lần sau có bằng chứng (CR-147 fix-e2e-community)
      console.error("[community] save profile image failed", e);
      const why = e instanceof Error ? e.message : String(e);
      setErr(`${t("community.me.imgFail")} (${why})`);
    } finally {
      setBusy(false);
    }
  };
  const pick = (f: File | undefined) => {
    if (!f) return;
    const c = checkImage(f, kind);
    if (c === "type") return setErr(t("community.me.imgType"));
    if (c === "big") return setErr(t("community.me.imgBig", { mb: maxBytesOf(kind) / 1048576 }));
    // CR-192: mở hộp cắt; ảnh lớn không bị từ chối — máy người dùng thu nhỏ khi bấm Lưu
    void run(async () => setSrc(await decodeSource(f)));
  };
  const closeCrop = () => {
    src?.release();
    setSrc(null);
  };
  const confirm = (rect: Rect) => {
    if (!src) return;
    void run(async () => {
      await onSave(await cropDataUrl(src, rect, kind));
      closeCrop();
    });
  };
  const cropLabels = {
    title: t(`community.me.crop.${kind}`),
    drag: t("community.me.crop.drag"),
    zoom: t("community.me.crop.zoom"),
    cancel: t("community.me.crop.cancel"),
    save: t("community.me.crop.save"),
  };
  const label = kind === "avatar" ? "avatar" : "cover";
  return (
    <>
      <span className={`imgpick imgpick-${kind}`} data-testid={testId}>
        <input
          ref={file}
          type="file"
          hidden
          accept="image/png,image/jpeg,image/webp"
          data-testid={`${testId}-file`}
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <IconButton
          className="imgpick-btn"
          disabled={busy}
          aria-label={t(`community.me.${label}Change`)}
          data-testid={`${testId}-change`}
          onClick={() => file.current?.click()}
        >
          <IconEdit size={16} />
        </IconButton>
        {hasImage && (
          <IconButton
            className="imgpick-btn"
            disabled={busy}
            aria-label={t(`community.me.${label}Remove`)}
            data-testid={`${testId}-remove`}
            onClick={() => void run(() => onSave(null))}
          >
            <IconTrash size={16} />
          </IconButton>
        )}
      </span>
      {src && (
        <ImageCropDialog
          labels={cropLabels}
          kind={kind}
          src={src}
          busy={busy}
          onCancel={closeCrop}
          onConfirm={confirm}
        />
      )}
      {err && (
        <span role="alert" className="imgpick-err muted" data-testid={`${testId}-err`}>
          {err}
        </span>
      )}
    </>
  );
}
