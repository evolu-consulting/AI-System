// HD-FR-93 · S10 · hàng khách + hàng mở rộng (nhóm bán, chữ ký) — port `CksPage.tsx:16-20, 135-187`.
import type { CksCustomerBrief } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { viDate, vnd } from "~/components/shared/format";

export function Expiry({ iso, days }: { iso: string; days: number }) {
  const { t } = useTranslation();
  if (days < 0)
    return (
      <span className="font-semibold text-late">
        {viDate(iso)} <span className="text-xs">{t("contracts.cks.expiredTag")}</span>
      </span>
    );
  if (days <= 30)
    return (
      <span className="font-semibold text-soon">
        {viDate(iso)} <span className="text-xs">{t("contracts.cks.daysLeft", { n: days })}</span>
      </span>
    );
  return <span>{viDate(iso)}</span>;
}

type Row = CksCustomerBrief;

export function CustomerRow({
  c,
  shown,
  open,
  toggle,
}: {
  c: Row;
  shown: string[];
  open: boolean;
  toggle: () => void;
}) {
  const { t } = useTranslation();
  const has = (k: string) => shown.includes(k);
  const bg = c.days_left < 0 ? "bg-late-bg/50" : c.elsewhere ? "bg-act-soft/50" : "";
  return (
    <tr className={`border-t border-rule-soft ${bg}`}>
      <td className="px-4 py-3.5">
        <span className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-label={t("contracts.cks.open", { name: c.name })}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-field bg-panel text-[10px]"
          >
            {open ? "▼" : "▶"}
          </button>
          <span>
            <Link
              to="/cks/$id"
              params={{ id: c.company_id }}
              className="font-semibold hover:underline"
            >
              {c.name}
            </Link>
            <span className="text-[13px] text-dim">
              {" · "}
              {t("contracts.cks.certCount", { n: c.cert_count })}
              {c.group_count ? ` · ${t("contracts.cks.groupCount", { n: c.group_count })}` : ""}
            </span>
            {c.elsewhere && (
              <span className="tag ml-2 text-[11px] font-semibold">
                {t("contracts.cks.elsewhere")}
              </span>
            )}
          </span>
        </span>
      </td>
      {has("ca") && <td className="px-4 text-sm">{c.ca}</td>}
      {has("earliest") && (
        <td className="px-4 text-sm">
          <Expiry iso={c.earliest} days={c.days_left} />
        </td>
      )}
      {has("price") && (
        <td className="px-4 text-right font-mono text-sm tnum">
          {c.has_sale ? (
            vnd(c.sale_price)
          ) : (
            <span className="font-sans text-dim">{t("contracts.cks.noSale")}</span>
          )}
        </td>
      )}
      {has("signed") && (
        <td className="px-4 text-right font-mono text-sm tnum">{c.signed_count}</td>
      )}
    </tr>
  );
}

function CertRow({ x, shown }: { x: Row["certs"][number]; shown: string[] }) {
  const { t } = useTranslation();
  const has = (k: string) => shown.includes(k);
  return (
    <tr className="border-t border-rule-soft text-[13.5px]">
      <td className="px-4 py-2.5 pl-16">
        {x.label}{" "}
        <span className="text-dim">
          · {x.device === "token" ? t("contracts.cks.token") : t("contracts.cks.remote")}
        </span>
      </td>
      {has("ca") && <td className="px-4">{x.ca}</td>}
      {has("earliest") && <td className="px-4">{viDate(x.valid_to)}</td>}
      {has("price") && <td className="px-4 text-right font-mono tnum">{vnd(x.sale_price)}</td>}
      {has("signed") && <td className="px-4 text-right font-mono tnum">{x.signed_count}</td>}
    </tr>
  );
}

export function Expanded({ c, shown }: { c: Row; shown: string[] }) {
  const { t } = useTranslation();
  return (
    <>
      {c.sales.map((s) => (
        <Fragment key={s.contract_id}>
          <tr className="bg-sunk">
            <td colSpan={shown.length} className="px-4 py-2.5 pl-16 text-[13px]">
              <Link
                to="/contracts/$id"
                params={{ id: s.contract_id }}
                className="font-semibold text-act underline underline-offset-2"
              >
                {t("contracts.cks.saleLine", { number: s.number })}
              </Link>
              {" · "}
              {t("contracts.cks.saleSigned", {
                date: viDate(s.signed_at),
                count: s.count,
                price: vnd(s.price_each),
              })}
              {s.valid_to ? t("contracts.cks.sameExpiry", { date: viDate(s.valid_to) }) : ""}
            </td>
          </tr>
          {c.certs
            .filter((x) => x.sale_contract_id === s.contract_id)
            .map((x) => (
              <CertRow key={x.id} x={x} shown={shown} />
            ))}
        </Fragment>
      ))}
      {c.certs
        .filter((x) => !x.sale_contract_id)
        .map((x) => (
          <CertRow key={x.id} x={x} shown={shown} />
        ))}
    </>
  );
}
