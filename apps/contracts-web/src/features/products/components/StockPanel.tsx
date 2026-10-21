// gap-d1 #18 · tab "Kho & lô" của chi tiết SP: thành phần (tồn, giá vốn BQ), các lô, và "Nhập lô" tay (SL, đơn giá, ngày, NCC; gói suất có hạn).
// Luật kho V2-B/V2-D giữ nguyên (BQ gia quyền, xuất FIFO) — máy chủ tính; ô xem trước chỉ là ước tính.
import type { ProductComponentOut } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { viDate, vnd } from "~/components/shared/format";
import { ErrorLine, Loading } from "~/components/shared/states";
import { toast } from "~/components/shared/toast";
import { today } from "~/features/ledger/lib/ledger";
import { useMe } from "~/features/pack-state/hooks/use-me";
import { knownCatalogError, useAddLot, useCatalogProduct } from "../hooks/use-catalog";
import { avgPreview, type LotForm, lotBody } from "../lib/catalog";
import { FIELD, Field } from "./Field";

const th = "px-4 py-2.5 text-left text-xs font-semibold text-dim bg-sunk";
const td = "border-t border-rule-soft px-4 py-2.5 text-sm";
const hasStock = (c: ProductComponentOut) => c.mode === "stock" || c.mode === "quota";
const blank = (): LotForm => ({
  qty: "",
  price: "",
  date: today(),
  expires: "",
  supplier: "",
  taxId: "",
  componentId: "",
});

function LotFormBox({
  id,
  comps,
  onDone,
}: {
  id: string;
  comps: ProductComponentOut[];
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.gapd1.lot.${k}`);
  const [f, setF] = useState<LotForm>(blank);
  const [err, setErr] = useState<string | null>(null);
  const add = useAddLot(id);
  const comp = comps.find((c) => c.id === f.componentId) ?? (comps[0] as ProductComponentOut);
  const body = lotBody({ ...f, componentId: comp.id }, comp.mode === "quota");
  const prev = avgPreview(comp.on_hand, comp.avg_cost, f.qty, f.price);
  const set = (k: keyof LotForm) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  return (
    <section className="flex flex-col gap-3 border-t border-rule-soft p-4" aria-label={L("title")}>
      <h4 className="text-sm font-semibold">{L("title")}</h4>
      <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
        {comps.length > 1 && (
          <div className="flex flex-col gap-1">
            <label htmlFor="gd1-l-comp" className="text-label text-ink-2">
              {L("component")}
            </label>
            <select id="gd1-l-comp" className={FIELD} value={comp.id} onChange={set("componentId")}>
              {comps.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <Field
          id="gd1-l-date"
          label={L("date")}
          type="date"
          value={f.date}
          max={today()}
          onChange={set("date")}
        />
        <Field
          id="gd1-l-qty"
          label={L("qty")}
          inputMode="decimal"
          value={f.qty}
          onChange={set("qty")}
        />
        <Field
          id="gd1-l-price"
          label={L("price")}
          inputMode="numeric"
          value={f.price}
          onChange={set("price")}
        />
        {comp.mode === "quota" && (
          <Field
            id="gd1-l-exp"
            label={L("expires")}
            type="date"
            value={f.expires}
            min={f.date}
            onChange={set("expires")}
          />
        )}
        <Field
          id="gd1-l-sup"
          label={L("supplier")}
          value={f.supplier}
          maxLength={300}
          onChange={set("supplier")}
        />
        {f.supplier.trim() !== "" && (
          <Field
            id="gd1-l-tax"
            label={L("taxId")}
            value={f.taxId}
            maxLength={30}
            onChange={set("taxId")}
          />
        )}
      </div>
      <p className="text-sm text-dim" data-testid="gd1-l-prev">
        {prev === null ? L("prevHint") : t("contracts.gapd1.lot.prev", { avg: vnd(prev) })}
      </p>
      {err && (
        <p role="alert" className="text-sm text-late">
          {err}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-quiet btn-sm" onClick={onDone}>
          {L("cancel")}
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          data-testid="gd1-l-save"
          disabled={!body || add.isPending}
          onClick={() =>
            body &&
            add.mutate(body, {
              onSuccess: () => {
                toast(L("done"));
                onDone();
              },
              onError: (e) => {
                const code = knownCatalogError(e);
                setErr(code ? t(`contracts.gapd1.errors.${code}`) : t("contracts.errors.unknown"));
              },
            })
          }
        >
          {L("save")}
        </button>
      </div>
    </section>
  );
}

export function StockPanel({ productId }: { productId: string }) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.gapd1.stock.${k}`);
  const { write } = useMe();
  const [open, setOpen] = useState(false);
  const q = useCatalogProduct(productId);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorLine error={q.error} />;
  const p = q.data;
  const stocked = p.components.filter(hasStock);
  const name = (cid: string) => p.components.find((c) => c.id === cid)?.name ?? "—";
  return (
    <div className="flex flex-col text-base leading-[1.55]">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <h3 className="text-base font-semibold">{L("title")}</h3>
        {p.spec && (
          <span className="text-sm text-dim">
            {t("contracts.gapd1.stock.spec", { spec: p.spec })}
          </span>
        )}
        {write && stocked.length > 0 && !open && (
          <button
            type="button"
            className="btn btn-outline btn-sm ml-auto"
            data-testid="gd1-l-open"
            onClick={() => setOpen(true)}
          >
            {L("addLot")}
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead>
            <tr>
              {(["component", "mode", "onHand", "avg", "value"] as const).map((c) => (
                <th key={c} className={th}>
                  {L(`col.${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {p.components.map((c) => (
              <tr key={c.id}>
                <td className={`${td} font-semibold`}>{c.name}</td>
                <td className={td}>{L(`mode.${c.mode}`)}</td>
                <td className={`${td} tnum`}>
                  {hasStock(c) ? `${c.on_hand} ${c.unit ?? ""}` : "—"}
                </td>
                <td className={`${td} tnum`}>{hasStock(c) ? vnd(c.avg_cost) : "—"}</td>
                <td className={`${td} tnum`}>{hasStock(c) ? vnd(c.stock_value) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && stocked.length > 0 && (
        <LotFormBox id={productId} comps={stocked} onDone={() => setOpen(false)} />
      )}
      <h4 className="px-4 pt-4 pb-2 text-sm font-semibold">{L("lots")}</h4>
      {p.lots.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-dim">{L("noLots")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr>
                {(["component", "received", "qty", "remaining", "expires"] as const).map((c) => (
                  <th key={c} className={th}>
                    {L(`lotCol.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.lots.map((l) => (
                <tr key={l.id}>
                  <td className={td}>{name(l.component_id)}</td>
                  <td className={`${td} tnum`}>{viDate(l.received_on)}</td>
                  <td className={`${td} tnum`}>{l.qty}</td>
                  <td className={`${td} tnum`}>{l.remaining}</td>
                  <td className={`${td} tnum`}>{l.expires_on ? viDate(l.expires_on) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
