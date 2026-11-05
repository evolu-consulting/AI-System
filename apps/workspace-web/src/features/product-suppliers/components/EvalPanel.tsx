// V2-J2 · SP-06: "Đánh giá nhà cung cấp" — mua nhiều hay ít, giá, uy tín ⇒ 4 gợi ý (Hợp tác tiếp / Duy trì nguồn phụ / Tìm nguồn
// thay thế / Có thể mua thử); chưa đủ cơ sở ⇒ "Tham khảo" (mockup-niti `supEvalPanel`).
import type { SupplierAdvice, SupplierOverviewOut } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { viDate, vnd } from "~/components/shared/format";
import { Panel } from "~/components/shared/layout";
import { RepCell } from "./ComparePanel";

const th = "px-4 py-3 text-left text-xs font-semibold text-dim bg-sunk";
const td = "border-t border-rule-soft px-4 py-3 text-sm";
const TAG: Record<SupplierAdvice | "none", string> = {
  keep: "tag-ok",
  backup: "",
  replace: "tag-late",
  trial: "tag-ok",
  none: "tag-grey",
};

export function EvalPanel({ suppliers }: { suppliers: SupplierOverviewOut["suppliers"] }) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.psup.${k}`);
  if (suppliers.length === 0) return null;
  return (
    <Panel>
      <div className="flex flex-wrap items-baseline gap-3 border-b border-rule-soft px-4 py-3">
        <h3 className="text-base font-semibold">{L("eval")}</h3>
        <span className="text-sm text-dim">{L("evalHint")}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead>
            <tr>
              <th className={th}>{L("col.supplier")}</th>
              <th className={th}>{L("col.rep")}</th>
              <th className={`${th} text-right`}>{L("col.times")}</th>
              <th className={th}>{L("col.share")}</th>
              <th className={`${th} text-right`}>{L("col.last")}</th>
              <th className={th}>{L("col.advice")}</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((s) => (
              <tr key={s.party_key}>
                <td className={`${td} font-semibold`}>
                  {s.supplier_name}
                  {s.bought_times > 0 && (
                    <div className="text-xs font-normal text-dim">{s.bought_qty}</div>
                  )}
                </td>
                <td className={td}>
                  <RepCell rep={s.reputation} />
                </td>
                <td className={`${td} text-right tnum`}>{s.bought_times}</td>
                <td className={td}>
                  <div className="h-1.5 w-24 overflow-hidden rounded bg-sunk">
                    <div className="h-full bg-act" style={{ width: `${s.share_pct}%` }} />
                  </div>
                  <span className="text-xs text-dim tnum">
                    {s.share_pct}% {L("ofValue")}
                  </span>
                </td>
                <td className={`${td} text-right tnum`}>
                  {viDate(s.last_on)}
                  {s.last_price !== null && (
                    <div className="text-xs text-dim">{vnd(s.last_price)}</div>
                  )}
                </td>
                <td className={td}>
                  <span className={`tag ${TAG[s.advice ?? "none"]}`}>
                    {L(`advice.${s.advice ?? "none"}`)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
