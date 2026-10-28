// com-c7 · CR-102b · R20–R22: nhãn trạng thái giá đã lưu ("Đã hết hạn" / "Đã thay" / "Đã gỡ"), nhãn VAT, và lịch sử giá đã thay/gỡ
// (thu gọn dưới bảng so sánh — không phải màn mới).
import type { SupplierPriceRow } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { viDate, vnd } from "~/components/shared/format";

export function StatusTag({ r }: { r: SupplierPriceRow }) {
  const { t } = useTranslation();
  if (!r.status) return null;
  return (
    <span className="tag ml-2 text-[11px]" data-testid={`psup-status-${r.status}`}>
      {t(`contracts.psup.status.${r.status}`)}
    </span>
  );
}

export function VatNote({ r }: { r: SupplierPriceRow }) {
  const { t } = useTranslation();
  return (
    <div className="text-[11px] font-sans text-dim">
      {t(r.vat_included ? "contracts.psup.incVat" : "contracts.psup.exVat")}
    </div>
  );
}

export function PriceHistory({ rows }: { rows: SupplierPriceRow[] | undefined }) {
  const { t } = useTranslation();
  if (!rows?.length) return null;
  return (
    <details className="border-t border-rule-soft px-4 py-3 text-sm" data-testid="psup-history">
      <summary className="cursor-pointer text-dim">
        {t("contracts.psup.history", { n: rows.length })}
      </summary>
      <ul className="mt-2 space-y-1">
        {rows.map((r) => (
          <li
            key={r.id ?? `${r.party_key}:${r.on}`}
            className="flex flex-wrap items-baseline gap-2 opacity-70"
          >
            <span className="font-semibold">{r.supplier_name}</span>
            <span className="font-mono tnum">{vnd(r.price)}</span>
            <span className="text-dim">{t(`contracts.psup.kind.${r.kind}`)}</span>
            <span className="text-dim tnum">{viDate(r.on)}</span>
            <StatusTag r={r} />
          </li>
        ))}
      </ul>
    </details>
  );
}
