// V2-F · HD-04 · mockup `summaryBody`: khối "Tóm tắt hợp đồng" — các điểm chính suy từ dữ liệu đã lưu (loại, đối tác, giá trị, hiệu lực, tiến độ,
// bước hiện tại + hạn) kèm lưu ý do agent đọc (cảnh báo). Chưa có tóm tắt viết bằng AI (V2-G) nên không bịa câu chữ.
import type { ContractDetail } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { Panel } from "~/components/shared/layout";
import { warningsOf } from "../lib/review";
import { type SummaryInput, summaryRows } from "../lib/summary";

type C = SummaryInput & Pick<ContractDetail, "warnings">;

export function SummaryPanel({ c, partner }: { c: C; partner: string }) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.cdetail.${k}`, o);
  const rows = summaryRows(c, partner, {
    labels: {
      deal: L("sumDeal"),
      partner: L("sumPartner"),
      commission: L("sumCommission"),
      value: L("sumValue"),
      period: L("sumPeriod"),
      progress: L("sumProgress"),
      next: L("sumNext"),
      lines: L("sumLines"),
    },
    dealName: (d) => t(`contracts.cform.dealName.${d}`),
    progress: (done, total) => L("progressCount", { done, total }),
  });
  const warnings = warningsOf(c);
  return (
    <Panel>
      <div className="border-b border-rule-soft px-5 py-3.5">
        <h2 className="text-[15px] font-semibold">{L("summary")}</h2>
      </div>
      <dl className="grid grid-cols-2 gap-2 px-5 py-4 max-sm:grid-cols-1" data-testid="summary">
        {rows.map(([k, val]) => (
          <div key={k} className="rounded-[10px] bg-sunk px-3 py-2">
            <dt className="text-[11.5px] text-dim">{k}</dt>
            <dd className="mt-0.5 text-[13.5px] font-semibold break-words">{val}</dd>
          </div>
        ))}
      </dl>
      {warnings.length > 0 && (
        <ul className="mx-5 mb-4 space-y-1 rounded-xl border border-soon-line bg-soon-bg p-3 text-[13px] text-soon">
          {warnings.map((w, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: cảnh báo không có id
            <li key={i}>{w.message}</li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
