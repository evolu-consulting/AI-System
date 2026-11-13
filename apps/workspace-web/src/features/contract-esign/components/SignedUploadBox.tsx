// CR-141 · khối «Tải lên bản đã ký» ở thẻ Ký số: chọn tệp (PDF/JPG/PNG) ⇒ Tải lên ⇒ bước Ký hợp đồng xong. Chỉ hiện khi bước đang chờ và người xem được tải.
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { useSignedUpload } from "../hooks/use-signed-upload";
import { SIGNED_ACCEPT } from "../lib/signed-upload-view";

export function SignedUploadBox({ up }: { up: ReturnType<typeof useSignedUpload> }) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  if (!up.show) return null;
  return (
    <div
      data-testid="signed-upload-box"
      className="mt-2 flex flex-col gap-1.5 border-t border-rule pt-2"
    >
      <b>{t("contracts.esign.upload.title")}</b>
      <span className="text-dim">{t("contracts.esign.upload.hint")}</span>
      {up.override && (
        <span className="text-act" data-testid="signed-upload-override">
          {t("contracts.esign.upload.override")}
        </span>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          accept={SIGNED_ACCEPT}
          aria-label={t("contracts.esign.upload.choose")}
          data-testid="signed-upload-input"
          className="max-w-full text-[13px]"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          className="btn btn-sm btn-primary"
          data-testid="signed-upload-submit"
          disabled={up.busy || !file}
          onClick={() =>
            file &&
            void up.upload(file).then((ok) => {
              if (!ok) return;
              setFile(null);
              if (input.current) input.current.value = "";
            })
          }
        >
          {t("contracts.esign.upload.submit")}
        </button>
      </div>
      {up.err && (
        <p role="alert" className="text-sm text-late" data-testid="signed-upload-error">
          {up.err}
        </p>
      )}
    </div>
  );
}
