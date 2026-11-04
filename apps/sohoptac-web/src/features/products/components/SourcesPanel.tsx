// gap-d1 #19 · tab "Cách lấy hàng" của chi tiết SP (BA KN-09): danh sách nguồn (NCC, thời gian giao, SL tối thiểu, giá tham chiếu),
// "Thêm cách lấy hàng", và bảng rủi ro phụ thuộc NCC (tỉ trọng mua ⊕ nguồn đã khai báo).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { vnd } from "~/components/shared/format";
import { ErrorLine, Loading } from "~/components/shared/states";
import { useMe } from "~/features/pack-state/hooks/use-me";
import {
  knownCatalogError,
  useAddSource,
  useDeleteSource,
  useProductSources,
} from "../hooks/use-catalog";
import { RISK_TONE, type SourceForm, sourceBody } from "../lib/catalog";
import { Field } from "./Field";

const th = "px-4 py-2.5 text-left text-xs font-semibold text-dim bg-sunk";
const td = "border-t border-rule-soft px-4 py-2.5 text-sm";
const EMPTY: SourceForm = {
  supplier: "",
  taxId: "",
  leadDays: "",
  moq: "",
  priceRef: "",
  note: "",
};

function AddForm({ id, onDone }: { id: string; onDone: () => void }) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.gapd1.src.${k}`);
  const [f, setF] = useState(EMPTY);
  const [err, setErr] = useState<string | null>(null);
  const add = useAddSource(id);
  const body = sourceBody(f);
  const set = (k: keyof SourceForm) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  return (
    <section
      className="flex flex-col gap-3 border-t border-rule-soft p-4"
      aria-label={L("addTitle")}
    >
      <h4 className="text-sm font-semibold">{L("addTitle")}</h4>
      <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
        <Field
          id="gd1-s-sup"
          label={L("supplier")}
          value={f.supplier}
          maxLength={300}
          onChange={set("supplier")}
        />
        <Field
          id="gd1-s-tax"
          label={L("taxId")}
          value={f.taxId}
          maxLength={30}
          onChange={set("taxId")}
        />
        <Field
          id="gd1-s-lead"
          label={L("lead")}
          inputMode="numeric"
          value={f.leadDays}
          onChange={set("leadDays")}
        />
        <Field
          id="gd1-s-moq"
          label={L("moq")}
          inputMode="decimal"
          value={f.moq}
          onChange={set("moq")}
        />
        <Field
          id="gd1-s-ref"
          label={L("priceRef")}
          inputMode="numeric"
          value={f.priceRef}
          onChange={set("priceRef")}
        />
        <Field
          id="gd1-s-note"
          label={L("note")}
          value={f.note}
          maxLength={500}
          onChange={set("note")}
        />
      </div>
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
          data-testid="gd1-s-save"
          disabled={!body || add.isPending}
          onClick={() =>
            body &&
            add.mutate(body, {
              onSuccess: onDone,
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

export function SourcesPanel({ productId }: { productId: string }) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.gapd1.src.${k}`, o);
  const { write } = useMe();
  const [open, setOpen] = useState(false);
  const q = useProductSources(productId);
  const del = useDeleteSource(productId);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorLine error={q.error} />;
  const { items, risk, single_source } = q.data;
  return (
    <div className="flex flex-col text-base leading-[1.55]">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <h3 className="text-base font-semibold">{L("title")}</h3>
        {write && !open && (
          <button
            type="button"
            className="btn btn-outline btn-sm ml-auto"
            data-testid="gd1-s-open"
            onClick={() => setOpen(true)}
          >
            {L("add")}
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="px-4 pb-3 text-sm text-dim">{L("empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr>
                {(["supplier", "lead", "moq", "priceRef", "note"] as const).map((c) => (
                  <th key={c} className={th}>
                    {L(c)}
                  </th>
                ))}
                {write && <th className={th} />}
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id}>
                  <td className={`${td} font-semibold`}>{s.supplier_name}</td>
                  <td className={`${td} tnum`}>
                    {s.lead_days === null ? "—" : L("days", { n: s.lead_days })}
                  </td>
                  <td className={`${td} tnum`}>{s.moq ?? "—"}</td>
                  <td className={`${td} tnum`}>{s.price_ref === null ? "—" : vnd(s.price_ref)}</td>
                  <td className={`${td} text-dim`}>{s.note ?? ""}</td>
                  {write && (
                    <td className={`${td} text-right`}>
                      <button
                        type="button"
                        className="btn btn-quiet btn-sm"
                        disabled={del.isPending}
                        onClick={() => del.mutate(s.id)}
                      >
                        {L("remove")}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <AddForm id={productId} onDone={() => setOpen(false)} />}
      <h4 className="px-4 pt-4 pb-1 text-sm font-semibold">{L("riskTitle")}</h4>
      {single_source && (
        <p role="note" className="px-4 pb-2 text-sm text-late">
          {L("single")}
        </p>
      )}
      {risk.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-dim">{L("riskEmpty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px]" data-testid="gd1-risk">
            <thead>
              <tr>
                {(["supplier", "share", "declared", "lead", "level"] as const).map((c) => (
                  <th key={c} className={th}>
                    {L(`risk.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {risk.map((r) => (
                <tr key={r.party_key}>
                  <td className={`${td} font-semibold`}>{r.supplier_name}</td>
                  <td className={`${td} tnum`}>{r.share_pct}%</td>
                  <td className={td}>{r.declared ? L("risk.yes") : L("risk.no")}</td>
                  <td className={`${td} tnum`}>
                    {r.lead_days === null ? "—" : L("days", { n: r.lead_days })}
                  </td>
                  <td className={`${td} font-semibold ${RISK_TONE[r.level]}`}>
                    {L(`risk.lv.${r.level}`)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
