// HD8-FR-05 · "Thêm báo giá" — port `PricesPage.tsx:126-169`: NCC, MST (nếu có), đơn giá (số nguyên đồng), ngày báo giá (mặc định
// hôm nay), link trang giá. Lỗi theo mã API; lưu xong làm mới so giá, xoá form, đóng.
import { ApiError } from "@ai/web-kit/http";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type RefObject, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { parseMoney } from "~/components/shared/format";
import { today } from "~/features/ledger/lib/ledger";
import { addQuote } from "~/features/partners/api";

const KNOWN = ["VALIDATION_ERROR", "NOT_FOUND", "PACK_FORBIDDEN"];

export function AddQuote({ dlg, product }: { dlg: RefObject<HTMLDialogElement>; product: string }) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.goods.${k}`);
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: đổi mặt hàng ⇒ xoá lỗi cũ (như mgmt)
  useEffect(() => setErr(null), [product]);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true);
    try {
      await addQuote({
        product,
        supplier_name: String(f.get("supplier")),
        supplier_tax_id: String(f.get("tax") || "") || undefined,
        price: parseMoney(String(f.get("price"))) ?? Number.NaN,
        quoted_at: String(f.get("date")),
        url: String(f.get("url") || "") || undefined,
      });
      await qc.invalidateQueries({ queryKey: ["prices"] });
      form.reset();
      dlg.current?.close();
    } catch (x) {
      setErr(
        x instanceof ApiError && KNOWN.includes(x.code)
          ? t(`contracts.goods.errors.${x.code}`)
          : t("contracts.errors.unknown"),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog ref={dlg} className="sheet">
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3 p-5">
        <h2 className="text-lg font-semibold">{L("dlgTitle")}</h2>
        <label className="text-[13px]">
          {L("supplier")}
          <input name="supplier" required className="field mt-1" />
        </label>
        <label className="text-[13px]">
          {L("tax")}
          <input name="tax" className="field mt-1" inputMode="numeric" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-[13px]">
            {L("price")}
            <input name="price" required className="field mt-1 font-mono" inputMode="numeric" />
          </label>
          <label className="text-[13px]">
            {L("date")}
            <input name="date" type="date" required className="field mt-1" defaultValue={today()} />
          </label>
        </div>
        <label className="text-[13px]">
          {L("url")}
          <input name="url" type="url" className="field mt-1" />
        </label>
        {err && (
          <p role="alert" className="text-sm text-late">
            {err}
          </p>
        )}
        <div className="mt-1 flex justify-end gap-2">
          <button type="button" className="btn btn-quiet" onClick={() => dlg.current?.close()}>
            {L("cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? L("saving") : L("save")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
