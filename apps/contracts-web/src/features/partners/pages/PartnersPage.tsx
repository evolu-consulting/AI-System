// HD8-FR-01 · S-p02 `/partners` — port `mgmt-app/web/src/pages/partners/PartnersPage.tsx:30-99`: mỗi đối tác một dòng (huy hiệu
// điểm, tên, vai · lý do), tìm + lọc Vai trò / Mức điểm, "+ Ghi việc" (sổ HD7) và "Chấm điểm" mở dưới dòng (một dòng mở một lúc).
import type { PartnerRow } from "@ai/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHead, Panel } from "~/components/shared/layout";
import { Empty, ErrorLine, Loading } from "~/components/shared/states";
import { PartnerLog } from "~/features/ledger/components/PartnerLog";
import { ColumnFilters, Pager, TableTools, useTable } from "~/features/table";
import { fetchPartners, fetchScoring, partnerKeys } from "../api";
import { PartnerRatings } from "../components/PartnerRatings";
import { ScoreBadge } from "../components/ScoreBadge";

type Open = { key: string; what: "log" | "rate" } | null;

function Row({ p, open, setOpen }: { p: PartnerRow; open: Open; setOpen: (o: Open) => void }) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.partners.${k}`);
  const key = `${p.party}:${p.role}`;
  return (
    <li
      className={`border-b border-rule-soft last:border-0 ${p.band === "watch" ? "bg-soon-bg/50" : ""}`}
    >
      <div className="flex items-center gap-4 px-5 py-3.5">
        <ScoreBadge score={p.score} band={p.band} />
        <span className="min-w-0">
          <span className="block truncate font-semibold">{p.name}</span>
          <span className="block truncate text-[13px] text-dim">
            {L(`roleWord.${p.role}`)} · {p.reason}
          </span>
        </span>
        <span className="ml-auto flex shrink-0 gap-1.5">
          {(["log", "rate"] as const).map((what) => {
            const on = open?.key === key && open.what === what;
            return (
              <button
                key={what}
                type="button"
                className={`btn h-9 text-[13px] ${on ? "btn-outline" : "btn-quiet"}`}
                aria-expanded={on}
                onClick={() => setOpen(on ? null : { key, what })}
              >
                {on ? L("close") : what === "log" ? L("log") : L("rate")}
              </button>
            );
          })}
        </span>
      </div>
      {open?.key === key && (
        <div className="px-5 pb-4">
          {open.what === "log" ? (
            <PartnerLog party={p.party} role={p.role} />
          ) : (
            <PartnerRatings party={p.party} role={p.role} />
          )}
        </div>
      )}
    </li>
  );
}

export function PartnersPage() {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.partners.${k}`, o);
  const q = useQuery({
    queryKey: partnerKeys.list("all"),
    queryFn: ({ signal }) => fetchPartners("all", signal),
  });
  const cfg = useQuery({
    queryKey: partnerKeys.scoring("customer"),
    queryFn: ({ signal }) => fetchScoring("customer", signal),
  });
  const months = cfg.data?.rules.window_months ?? 12;
  const tb = useTable(q.data, {
    text: (p) => `${p.name} ${L(`roleWord.${p.role}`)} ${p.reason}`,
    filters: [
      { key: "role", label: L("role"), value: (p) => L(`roleWord.${p.role}`) },
      {
        key: "band",
        label: L("bandFilter"),
        value: (p) => (p.band ? L(`band.${p.band}`) : L("noBand")),
      },
    ],
  });
  const [open, setOpen] = useState<Open>(null);
  const body = () => {
    if (q.isLoading) return <Loading />;
    if (q.error) return <ErrorLine error={q.error} />;
    if (!q.data?.length) return <Empty title={L("emptyTitle")}>{L("emptyBody")}</Empty>;
    if (!tb.total) return <Empty title={L("noMatchTitle")}>{L("noMatchBody")}</Empty>;
    return (
      <ul className="md:min-h-0 md:flex-1 md:overflow-auto">
        {tb.shown.map((p) => (
          <Row key={`${p.party}:${p.role}`} p={p} open={open} setOpen={setOpen} />
        ))}
      </ul>
    );
  };
  return (
    // Như mgmt (trang nằm thẳng trong `main` flex-col): khung danh sách giãn tới đáy, danh sách cuộn bên trong.
    <div className="text-base leading-[1.55] md:flex md:min-h-0 md:flex-1 md:flex-col">
      <PageHead title={L("title")} titleMobileOnly />
      <TableTools q={tb.q} setQ={tb.setQ} total={tb.total} placeholder={L("search")}>
        <ColumnFilters filter={tb.filter} />
      </TableTools>
      <Panel className="md:flex md:min-h-0 md:flex-1 md:flex-col">
        {body()}
        <Pager t={tb} />
      </Panel>
      <p className="mt-4 text-[13px] text-dim">
        {L("foot", { months })}{" "}
        <Link
          to="/settings/scoring"
          className="font-semibold text-act underline underline-offset-2"
        >
          {L("howLink")}
        </Link>
      </p>
    </div>
  );
}
