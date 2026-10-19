// HD-FR-91 · S10 · "+ Nhập lô mua" — port `dialogs.tsx:65-92` (cùng ô, nhãn, bố cục). Lệnh gửi do trang truyền vào.
import type { CksLotCreate } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { dayPlus, num } from "../lib/cks";
import { Actions, Alert, type DialogRef, useSubmit } from "./dialog-kit";

export function NewLotDialog({
  dlg,
  create,
}: {
  dlg: DialogRef;
  create: (b: Partial<CksLotCreate>) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.cks.dialog.${k}`);
  const today = dayPlus(0);
  const s = useSubmit(dlg, (f) =>
    create({
      ca: String(f.get("ca")),
      supplier_name: String(f.get("supplier") || f.get("ca")),
      qty: num(f.get("qty")),
      unit_cost: num(f.get("cost")),
      years: num(f.get("years")) || 1,
      bought_at: String(f.get("date")),
      label: String(f.get("label") || "") || null,
      device: f.get("device") === "remote" ? "remote" : "token",
    }),
  );
  return (
    <dialog ref={dlg} className="sheet">
      <form onSubmit={s.onSubmit} className="flex flex-col gap-3 p-5">
        <h2 className="text-lg font-semibold">{L("lotTitle")}</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-[13px]">
            {L("lotCa")}
            <input name="ca" required className="field mt-1" placeholder="Viettel-CA" />
          </label>
          <label className="text-[13px]">
            {L("lotLabel")}
            <input name="label" className="field mt-1" placeholder={today.slice(0, 7)} />
          </label>
          <label className="text-[13px]">
            {L("qty")}
            <input name="qty" required className="field mt-1 font-mono" inputMode="numeric" />
          </label>
          <label className="text-[13px]">
            {L("cost")}
            <input name="cost" required className="field mt-1 font-mono" inputMode="numeric" />
          </label>
          <label className="text-[13px]">
            {L("years")}
            <input
              name="years"
              defaultValue={1}
              className="field mt-1 font-mono"
              inputMode="numeric"
            />
          </label>
          <label className="text-[13px]">
            {L("boughtAt")}
            <input name="date" type="date" defaultValue={today} required className="field mt-1" />
          </label>
          <label className="col-span-2 text-[13px]">
            {L("device")}
            <select name="device" className="field mt-1">
              <option value="token">{t("contracts.cks.token")}</option>
              <option value="remote">{t("contracts.cks.remote")}</option>
            </select>
          </label>
        </div>
        <Alert err={s.err} />
        <Actions dlg={dlg} busy={s.busy} label={L("lotSubmit")} />
      </form>
    </dialog>
  );
}
