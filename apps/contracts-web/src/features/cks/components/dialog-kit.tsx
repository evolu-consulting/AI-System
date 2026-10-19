// HD-FR-91…94 · S10/S11 · khung hộp thoại CKS — port `dialogs.tsx:10-38`: `<dialog class="sheet">` gốc, gửi form ⇒ chạy lệnh ⇒
// làm mới dữ liệu ⇒ reset form ⇒ đóng; lỗi hiện `role="alert"` (câu theo mã API, không thông điệp thô).
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type RefObject, useState } from "react";
import { useTranslation } from "react-i18next";
import { cksErrorText } from "../lib/cks";

export type DialogRef = RefObject<HTMLDialogElement>;

/** `onDone`: reset phần React giữ (số người giữ, ngày đã chọn); `form.reset()` chỉ xoá ô nhập. */
export function useSubmit(
  ref: DialogRef,
  run: (f: FormData) => Promise<unknown>,
  onDone?: () => void,
) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setErr(null);
    try {
      await run(new FormData(form));
      await qc.invalidateQueries();
      form.reset();
      onDone?.();
      ref.current?.close();
    } catch (x) {
      setErr(cksErrorText(x, t));
    } finally {
      setBusy(false);
    }
  }
  return { err, busy, onSubmit };
}

export function Actions({
  dlg,
  busy,
  label,
  disabled,
}: {
  dlg: DialogRef;
  busy: boolean;
  label: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-1 flex justify-end gap-2">
      <button type="button" className="btn btn-quiet" onClick={() => dlg.current?.close()}>
        {t("contracts.cks.dialog.cancel")}
      </button>
      <button type="submit" className="btn btn-primary" disabled={busy || disabled}>
        {busy ? t("contracts.cks.dialog.saving") : label}
      </button>
    </div>
  );
}

export function Alert({ err }: { err: string | null }) {
  return err ? (
    <p role="alert" className="text-sm text-late">
      {err}
    </p>
  ) : null;
}
