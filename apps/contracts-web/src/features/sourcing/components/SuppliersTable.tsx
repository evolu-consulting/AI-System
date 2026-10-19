// W1 · bảng "Phụ thuộc vào nhà cung cấp" (port cm-web `sourcing/page.tsx`): số dòng bán dựa vào, khách hàng, lãi gộp, dòng rủi ro.
import type { SupplierExposure } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { vnd } from "~/components/shared/format";
import { Panel } from "~/components/shared/layout";

const th = "px-4 py-3 text-left text-xs font-semibold text-dim whitespace-nowrap bg-sunk";
const td = "px-4 py-3 border-t border-rule-soft text-[13px]";

export function SuppliersTable({ suppliers }: { suppliers: SupplierExposure[] }) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.sourcing.${k}`, o);
  return (
    <Panel>
      <h2 className="border-b border-rule px-5 py-3.5 text-[15px] font-semibold">
        {L("suppliers")}
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse">
          <thead>
            <tr>
              <th className={th}>{L("sup.name")}</th>
              <th className={`${th} text-right`}>{L("sup.lines")}</th>
              <th className={th}>{L("sup.customers")}</th>
              <th className={`${th} text-right`}>{L("sup.profit")}</th>
              <th className={th}>{L("sup.risk")}</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((x) => (
              <tr
                key={x.supplier.key ?? x.supplier.name}
                data-testid="supplier-row"
                className="hover:bg-sunk"
              >
                <td className={td}>{x.supplier.name ?? "—"}</td>
                <td className={`${td} tnum text-right font-mono`}>{x.lines}</td>
                <td className={td}>{x.customers.join("; ") || "—"}</td>
                <td className={`${td} tnum text-right font-mono`}>{vnd(x.profit)}</td>
                <td className={td}>
                  {x.at_risk ? (
                    <span className="rounded-full bg-late-bg px-2.5 py-0.5 text-xs font-semibold text-late">
                      {L("sup.atRisk", { n: x.at_risk })}
                    </span>
                  ) : (
                    <span className="text-dim">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
