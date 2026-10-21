// V2-J2 · SP-04: "So sánh giá nhà cung cấp" — Mua mới / Gia hạn, giá vốn BQ của mình, nguồn giá, uy tín, ngày (mockup-niti `cmpPanel`).
import type { SupplierOverviewOut, SupplierPriceKind, SupplierPriceRow } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { viDate, vnd } from "~/components/shared/format";
import { Panel } from "~/components/shared/layout";
import { today } from "~/features/ledger/lib/ledger";
import { hasRenew, isOld, rowsOfKind } from "../lib/suppliers";
import { AddPartnerButton } from "./AddPartnerButton";

const th = "px-4 py-3 text-left text-xs font-semibold text-dim bg-sunk";
const td = "border-t border-rule-soft px-4 py-3 text-sm";

export function RepCell({ rep }: { rep: SupplierPriceRow["reputation"] }) {
  const { t } = useTranslation();
  if (!rep) return <span className="text-dim">{t("contracts.psup.noRep")}</span>;
  return (
    <span className={rep.level === "watch" ? "font-semibold text-soon" : "font-semibold"}>
      {rep.score ?? "—"} · {t(`contracts.psup.level.${rep.level}`)}
    </span>
  );
}

function Delta({ pct }: { pct: number | null }) {
  const { t } = useTranslation();
  if (pct === null) return <span className="text-dim">—</span>;
  if (pct === 0) return <span className="text-dim">{t("contracts.psup.equal")}</span>;
  return pct < 0 ? (
    <span className="text-ok">▼ {-pct}%</span>
  ) : (
    <span className="text-late">▲ {pct}%</span>
  );
}

export function ComparePanel({
  data,
  write,
  onSearch,
  onManual,
  onQuote,
  onDelete,
}: {
  data: SupplierOverviewOut;
  write: boolean;
  onSearch: () => void;
  onManual: () => void;
  onQuote: () => void;
  onDelete: (priceId: string) => void;
}) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.psup.${k}`, o);
  const [kind, setKind] = useState<SupplierPriceKind>("new");
  const renew = hasRenew(data.rows);
  const rows = rowsOfKind(data.rows, renew ? kind : "new");
  const day = today();
  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-3 border-b border-rule-soft px-4 py-3">
        <h3 className="text-base font-semibold">{L("compare")}</h3>
        {renew && (
          <span className="seg">
            {(["new", "renew"] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={kind === k ? "on" : ""}
                onClick={() => setKind(k)}
              >
                {L(`kind.${k}`)}
              </button>
            ))}
          </span>
        )}
        {write && (
          <span className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              data-testid="gd1-manual-open"
              onClick={onManual}
            >
              {t("contracts.gapd1.manual.open")}
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              data-testid="gd1-quote-open"
              onClick={onQuote}
            >
              {t("contracts.gapd1.quote.open")}
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={onSearch}>
              {L("search")}
            </button>
          </span>
        )}
      </div>
      {data.own_avg_cost !== null && (
        <p className="flex items-baseline gap-2 px-4 py-3 text-sm">
          <span className="text-dim">{L("own")}</span>
          <b className="font-mono tnum">{vnd(data.own_avg_cost)}</b>
          <span className="text-dim">{L("ownNote")}</span>
        </p>
      )}
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-dim">{L("empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr>
                <th className={th}>{L("col.supplier")}</th>
                <th className={`${th} text-right`}>{L("col.price")}</th>
                <th className={`${th} text-right`}>{L("col.vsOwn")}</th>
                <th className={th}>{L("col.source")}</th>
                <th className={th}>{L("col.rep")}</th>
                <th className={th}>{L("col.date")}</th>
                {write && <th className={th} />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id ?? `${r.party_key}:${r.source}`}
                  className={isOld(r.on, day) ? "opacity-70" : ""}
                >
                  <td className={`${td} font-semibold`}>{r.supplier_name}</td>
                  <td className={`${td} text-right font-mono tnum`}>
                    {vnd(r.price)}
                    <div className="text-[11px] font-sans text-dim">{L("exVat")}</div>
                  </td>
                  <td className={`${td} text-right`}>
                    <Delta pct={r.vs_own_pct} />
                  </td>
                  <td className={td}>
                    {r.url ? (
                      <a href={r.url} target="_blank" rel="noreferrer noopener" className="link">
                        {L(`source.${r.source}`)}
                      </a>
                    ) : (
                      L(`source.${r.source}`)
                    )}
                    {isOld(r.on, day) && <span className="tag ml-2 text-[11px]">{L("old")}</span>}
                  </td>
                  <td className={td}>
                    <RepCell rep={r.reputation} />
                  </td>
                  <td className={`${td} text-dim tnum`}>{viDate(r.on)}</td>
                  {write && (
                    <td className={`${td} text-right`}>
                      <div className="flex justify-end gap-2">
                        <AddPartnerButton row={r} />
                        {r.id && (
                          <button
                            type="button"
                            className="btn btn-quiet btn-sm"
                            onClick={() => onDelete(r.id as string)}
                          >
                            {L("remove")}
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
