// CR-147b · nút chọn ảnh (avatar hoặc ảnh bìa) + nút xoá. Kiểm loại/dung lượng, báo lỗi bằng nhãn nghiệp vụ; lưu qua `onSave` (null = xoá).
import { useRef, useState } from "react";
import { checkImage, type ImageKind, maxBytesOf } from "../../domain/image";
import { t } from "../../i18n";
import { avatarDataUrl, coverDataUrl } from "./image-file";

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
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      // lỗi thật (message) ra console + hậu tố trong thông báo chung để lần sau có bằng chứng (CR-147 fix-e2e-community)
      console.error("[community] lưu ảnh hồ sơ lỗi", e);
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
    void run(async () => onSave(await (kind === "avatar" ? avatarDataUrl(f) : coverDataUrl(f))));
  };
  const label = kind === "avatar" ? "avatar" : "cover";
  return (
    <span
      className="imgpick"
      data-testid={testId}
      style={{ display: "inline-flex", gap: 8, alignItems: "center" }}
    >
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
      <button
        type="button"
        className="btn sm"
        disabled={busy}
        onClick={() => file.current?.click()}
      >
        {t(`community.me.${label}Change`)}
      </button>
      {hasImage && (
        <button
          type="button"
          className="btn sm quiet"
          disabled={busy}
          data-testid={`${testId}-remove`}
          onClick={() => void run(() => onSave(null))}
        >
          {t(`community.me.${label}Remove`)}
        </button>
      )}
      {err && (
        <span role="alert" className="muted" data-testid={`${testId}-err`}>
          {err}
        </span>
      )}
    </span>
  );
}
