// CR-182 · R6 · nút «Thêm phụ lục cần ký» trên HĐ đã duyệt/ký: chọn PDF ⇒ tạo phụ lục ⇒ mở trang phụ lục (chỗ ký + Gửi duyệt như HĐ thường).
import { Button } from "@ai/web-kit/ui/kit/button";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { uploadErrorText } from "~/features/contracts-list/list-upload-error";
import { createAnnex } from "./annex";

export function AnnexAdd({ parentId }: { parentId: string }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pick = async (file: File) => {
    setBusy(true);
    setErr(null);
    try {
      const id = await createAnnex(parentId, file);
      await nav({ to: "/contracts/c/$id", params: { id } });
    } catch (e) {
      setErr(uploadErrorText(e, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3" data-testid="annex-add">
      <input
        ref={ref}
        type="file"
        hidden
        accept="application/pdf,.pdf"
        data-testid="annex-file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void pick(f);
        }}
      />
      <Button variant="outline" size="sm" busy={busy} onClick={() => ref.current?.click()}>
        {t("contracts.annex.add")}
      </Button>
      <p className="mt-1 text-label text-dim">{t("contracts.annex.hint")}</p>
      {err && (
        <p role="alert" data-testid="annex-error" className="mt-1 text-sm text-danger">
          {err}
        </p>
      )}
    </div>
  );
}
