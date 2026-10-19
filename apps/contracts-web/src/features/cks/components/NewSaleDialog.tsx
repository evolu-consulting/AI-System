// HD-FR-92 · S10 · "+ Hợp đồng bán chữ ký" — port `dialogs.tsx:94-153`: khách, MST, lô còn hàng, giá, ngày ký, hạn tự theo lô (tới khi
// người dùng tự chọn), người giữ thêm dòng; xong một lần bán ⇒ form về mặc định (1 người giữ, hôm nay, lô đầu).
import type { CksLot, CksSaleCreate } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { autoValid, dayPlus, num } from "../lib/cks";
import { Actions, Alert, type DialogRef, useSubmit } from "./dialog-kit";

function HolderRow({ i }: { i: number }) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.cks.dialog.${k}`);
  return (
    <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 max-sm:grid-cols-2">
      <input
        name={`h${i}`}
        required
        placeholder={L("holderName")}
        className="field"
        aria-label={L("holderNameAria")}
      />
      <input
        name={`t${i}`}
        placeholder={L("holderTitle")}
        className="field"
        aria-label={L("holderTitleAria")}
      />
      <input
        name={`s${i}`}
        placeholder={L("serialPh")}
        className="field font-mono"
        aria-label={L("serialAria")}
      />
      <select name={`d${i}`} className="field w-auto" aria-label={L("deviceAria")}>
        <option value="token">{t("contracts.cks.token")}</option>
        <option value="remote">{t("contracts.cks.remote")}</option>
      </select>
    </div>
  );
}

const body = (f: FormData, holders: number): CksSaleCreate => ({
  company_name: String(f.get("company")),
  company_tax_id: String(f.get("tax") || "") || null,
  lot_id: String(f.get("lot")),
  price_each: num(f.get("price")),
  signed_at: String(f.get("signed")),
  valid_to: String(f.get("valid")),
  holders: Array.from({ length: holders }, (_, i) => ({
    name: String(f.get(`h${i}`)),
    title: String(f.get(`t${i}`) || "") || null,
    device: f.get(`d${i}`) === "remote" ? "remote" : "token",
    serial: String(f.get(`s${i}`) || "") || null,
    keeper: null,
  })),
});

export function NewSaleDialog({
  dlg,
  lots,
  company,
  create,
}: {
  dlg: DialogRef;
  lots: CksLot[];
  company?: string;
  create: (b: CksSaleCreate) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.cks.dialog.${k}`, o);
  const [holders, setHolders] = useState(1);
  const [lotId, setLotId] = useState("");
  const [signed, setSigned] = useState(dayPlus(0));
  const [valid, setValid] = useState<string | null>(null);
  const fresh = () => {
    setHolders(1);
    setLotId("");
    setSigned(dayPlus(0));
    setValid(null);
  };
  const s = useSubmit(dlg, (f) => create(body(f, holders)), fresh);
  const inStock = lots.filter((l) => l.in_stock > 0);
  const years = (inStock.find((l) => l.id === lotId) ?? inStock[0])?.years ?? 1;
  return (
    <dialog ref={dlg} className="sheet">
      <form onSubmit={s.onSubmit} className="flex flex-col gap-3 p-5">
        <h2 className="text-lg font-semibold">{L("saleTitle")}</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-[13px]">
            {L("company")}
            <input
              key={company}
              name="company"
              required
              className="field mt-1"
              defaultValue={company}
            />
          </label>
          <label className="text-[13px]">
            {L("tax")}
            <input name="tax" className="field mt-1 font-mono" inputMode="numeric" />
          </label>
          <label className="col-span-2 text-[13px]">
            {L("fromLot")}
            <select
              name="lot"
              required
              className="field mt-1"
              value={lotId || inStock[0]?.id || ""}
              onChange={(e) => setLotId(e.target.value)}
            >
              {inStock.map((l) => (
                <option key={l.id} value={l.id}>
                  {L("lotOption", { label: l.label, ca: l.ca, years: l.years ?? 1, n: l.in_stock })}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[13px]">
            {L("price")}
            <input name="price" required className="field mt-1 font-mono" inputMode="numeric" />
          </label>
          <label className="text-[13px]">
            {L("signedAt")}
            <input
              name="signed"
              type="date"
              value={signed}
              onChange={(e) => setSigned(e.target.value)}
              required
              className="field mt-1"
            />
          </label>
          <label className="text-[13px]">
            {L("validTo")}
            <input
              name="valid"
              type="date"
              value={valid ?? autoValid(signed, years)}
              onChange={(e) => setValid(e.target.value)}
              required
              className="field mt-1"
            />
          </label>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-semibold">{L("holders")}</legend>
          {Array.from({ length: holders }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: dòng người giữ chỉ thêm cuối, tên ô theo chỉ số (như mgmt-app)
            <HolderRow key={i} i={i} />
          ))}
          <button
            type="button"
            className="chip chip-dashed self-start"
            onClick={() => setHolders(holders + 1)}
          >
            {L("addHolder")}
          </button>
        </fieldset>
        {!inStock.length && <p className="text-sm text-soon">{L("noStock")}</p>}
        <Alert err={s.err} />
        <Actions dlg={dlg} busy={s.busy} label={L("saleSubmit")} disabled={!inStock.length} />
      </form>
    </dialog>
  );
}
