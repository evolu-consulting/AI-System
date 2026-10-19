// HD-FR-93 · S10 · hàng lọc — port `CksPage.tsx:85-98`: Tất cả · Sắp/Đã hết hạn · Theo lô mua · Nhà cung cấp.
import type { CksLot } from "@ai/contracts";
import { useTranslation } from "react-i18next";

export type Filter = { filter?: "expiring" | "expired" | "elsewhere"; lot?: string; ca?: string };

export function CksFilters({
  f,
  setF,
  lots,
  cas,
}: {
  f: Filter;
  setF: (f: Filter) => void;
  lots: CksLot[];
  cas: string[];
}) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.cks.filter.${k}`, o);
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      <button
        type="button"
        className="chip"
        aria-pressed={!f.filter && !f.lot && !f.ca}
        onClick={() => setF({})}
      >
        {L("all")}
      </button>
      <button
        type="button"
        className="chip text-soon"
        aria-pressed={f.filter === "expiring" || f.filter === "expired"}
        onClick={() => setF({ ...f, filter: f.filter ? undefined : "expiring" })}
      >
        {f.filter === "expired" ? L("expired") : L("expiring")}
      </button>
      <select
        aria-label={L("lot")}
        className="chip pr-2"
        value={f.lot ?? ""}
        onChange={(e) => setF({ ...f, lot: e.target.value || undefined })}
      >
        <option value="">{L("lot")}</option>
        {lots.map((l) => (
          <option key={l.id} value={l.id}>
            {L("lotOption", { label: l.label, ca: l.ca })}
          </option>
        ))}
      </select>
      <select
        aria-label={L("ca")}
        className="chip pr-2"
        value={f.ca ?? ""}
        onChange={(e) => setF({ ...f, ca: e.target.value || undefined })}
      >
        <option value="">{L("ca")}</option>
        {cas.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </div>
  );
}
