// gap-d1 #21 · "Nhập giá tay": NCC + giá chưa VAT (+ loại, đơn vị, ngày, ghi chú) ⇒ lưu vào bảng so sánh với nguồn "Nhập tay".
import type { SupplierPriceKind } from "@ai/contracts";
import { type RefObject, useState } from "react";
import { useTranslation } from "react-i18next";
import { FIELD, Field } from "~/features/products/components/Field";
import { useSavePrices } from "../hooks/use-quote";
import { type ManualPriceForm, manualPriceBody } from "../lib/suppliers";

const EMPTY: ManualPriceForm = {
  supplier: "",
  taxId: "",
  kind: "new",
  price: "",
  unit: "",
  date: "",
  note: "",
};

export function ManualPriceDialog({
  dlg,
  productId,
}: {
  dlg: RefObject<HTMLDialogElement>;
  productId: string;
}) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.gapd1.manual.${k}`);
  const [f, setF] = useState(EMPTY);
  const [err, setErr] = useState(false);
  const save = useSavePrices(productId);
  const body = manualPriceBody(f);
  const set = (k: keyof ManualPriceForm) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  const close = () => {
    setF(EMPTY);
    setErr(false);
    dlg.current?.close();
  };
  return (
    <dialog ref={dlg} className="sheet" onClose={() => setErr(false)}>
      <div className="flex min-w-[min(520px,90vw)] flex-col gap-3 p-5">
        <h2 className="text-lg font-semibold">{L("title")}</h2>
        <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <Field
            id="gd1-m-sup"
            label={L("supplier")}
            value={f.supplier}
            maxLength={300}
            onChange={set("supplier")}
          />
          <Field
            id="gd1-m-tax"
            label={L("taxId")}
            value={f.taxId}
            maxLength={30}
            onChange={set("taxId")}
          />
          <Field
            id="gd1-m-price"
            label={L("price")}
            inputMode="numeric"
            value={f.price}
            onChange={set("price")}
          />
          <div className="flex flex-col gap-1">
            <label htmlFor="gd1-m-kind" className="text-label text-ink-2">
              {L("kind")}
            </label>
            <select
              id="gd1-m-kind"
              className={FIELD}
              value={f.kind}
              onChange={(e) => setF({ ...f, kind: e.target.value as SupplierPriceKind })}
            >
              {(["new", "renew"] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`contracts.psup.kind.${k}`)}
                </option>
              ))}
            </select>
          </div>
          <Field
            id="gd1-m-unit"
            label={L("unit")}
            value={f.unit}
            maxLength={40}
            onChange={set("unit")}
          />
          <Field
            id="gd1-m-date"
            label={L("date")}
            type="date"
            value={f.date}
            onChange={set("date")}
          />
        </div>
        <Field
          id="gd1-m-note"
          label={L("note")}
          value={f.note}
          maxLength={500}
          onChange={set("note")}
        />
        <p className="text-xs text-dim">{L("exVat")}</p>
        {err && (
          <p role="alert" className="text-sm text-late">
            {t("contracts.errors.unknown")}
          </p>
        )}
        <div className="mt-1 flex justify-end gap-2">
          <button type="button" className="btn btn-quiet" onClick={close}>
            {t("contracts.psup.close")}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="gd1-m-save"
            disabled={!body || save.isPending}
            onClick={() =>
              body && save.mutate([body], { onSuccess: close, onError: () => setErr(true) })
            }
          >
            {L("save")}
          </button>
        </div>
      </div>
    </dialog>
  );
}
