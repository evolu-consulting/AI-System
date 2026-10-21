// V2-I · DT-01 · S-p02 `/partners` v2 — mockup NITI: mỗi đối tác một dòng (tên, các vai, điểm từng vai, số hợp đồng), tìm + lọc vai /
// "Cần chú ý"; bấm tên mở trang chi tiết. Dữ liệu từ `/reputation/partners` (V2-E) thay `GET /partners` cũ; "+ Ghi việc" (sổ HD7) giữ lại.
import type { PartnerRole, RepRole } from "@ai/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHead, Panel } from "~/components/shared/layout";
import { Empty, ErrorLine, Loading } from "~/components/shared/states";
import { PartnerLog } from "~/features/ledger/components/PartnerLog";
import { useMe } from "~/features/pack-state/hooks/use-me";
import { Pager, TableTools, useTable } from "~/features/table";
import { cn } from "~/lib/utils";
import { fetchContractCounts, fetchRepPartners, partnerKeys } from "../api";
import { AddCompanyDialog } from "../components/AddCompanyDialog";
import { MineBanner } from "../components/MineBanner";
import { RepBadge } from "../components/RepBadge";
import { type PartyItem, partiesOf, ROLES } from "../lib/partner-v2";

type Filter = "all" | RepRole | "watch";
const FILTERS: readonly Filter[] = ["all", ...ROLES, "watch"];
const LOGGABLE = (r: RepRole): r is PartnerRole => r === "customer" || r === "supplier";

function Row({ p, open, setOpen }: { p: PartyItem; open: boolean; setOpen: (v: boolean) => void }) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.pv2.${k}`, o);
  const { write } = useMe();
  const loggable = p.roles.find((r) => LOGGABLE(r.role));
  return (
    <li
      className={cn(
        "border-b border-rule-soft last:border-0",
        p.worst === "watch" && "bg-soon-bg/50",
      )}
    >
      <div className="flex flex-wrap items-center gap-4 px-5 py-3.5">
        <span className="flex shrink-0 gap-2">
          {p.roles.map((r) => (
            <RepBadge key={r.role} score={r.score} level={r.level} role={r.role} />
          ))}
        </span>
        <span className="min-w-0 flex-1 basis-56">
          <Link
            to="/partners"
            search={{ party: p.party }}
            className="block truncate font-semibold text-ink hover:text-act hover:underline"
          >
            {p.name}
          </Link>
          <span className="block truncate text-[13px] text-dim">
            {p.roles.map((r) => L(`roleWord.${r.role}`)).join(" · ")} ·{" "}
            {L("contractsN", { n: p.contracts })}
          </span>
        </span>
        <span className="ml-auto flex shrink-0 gap-1.5">
          {write && loggable && (
            <button
              type="button"
              className={cn("btn h-9 text-[13px]", open ? "btn-outline" : "btn-quiet")}
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              {open ? L("close") : L("log")}
            </button>
          )}
          <Link
            to="/partners"
            search={{ party: p.party }}
            className="btn btn-quiet h-9 text-[13px]"
          >
            {L("detail")}
          </Link>
        </span>
      </div>
      {open && loggable && (
        <div className="px-5 pb-4">
          <PartnerLog party={p.party} role={loggable.role as PartnerRole} />
        </div>
      )}
    </li>
  );
}

export function PartnersPage() {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.pv2.${k}`, o);
  const q = useQuery({
    queryKey: partnerKeys.repList,
    queryFn: ({ signal }) => fetchRepPartners(signal),
  });
  const counts = useQuery({
    queryKey: partnerKeys.counts,
    queryFn: ({ signal }) => fetchContractCounts(signal),
  });
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const { write } = useMe();
  const items = useMemo(
    () => partiesOf(q.data, new Map((counts.data ?? []).map((c) => [c.party, c.n]))),
    [q.data, counts.data],
  );
  const shown = useMemo(
    () =>
      items.filter((p) =>
        filter === "all"
          ? true
          : filter === "watch"
            ? p.worst === "watch"
            : p.roles.some((r) => r.role === filter),
      ),
    [items, filter],
  );
  const tb = useTable(shown, {
    text: (p) => `${p.name} ${p.roles.map((r) => L(`roleWord.${r.role}`)).join(" ")}`,
  });
  const body = () => {
    if (q.isLoading) return <Loading />;
    if (q.error) return <ErrorLine error={q.error} />;
    if (!items.length) return <Empty title={L("emptyTitle")}>{L("emptyBody")}</Empty>;
    if (!tb.total) return <Empty title={L("noMatchTitle")}>{L("noMatchBody")}</Empty>;
    return (
      <ul className="md:min-h-0 md:flex-1 md:overflow-auto">
        {tb.shown.map((p) => (
          <Row
            key={p.party}
            p={p}
            open={open === p.party}
            setOpen={(v) => setOpen(v ? p.party : null)}
          />
        ))}
      </ul>
    );
  };
  return (
    <div className="text-base leading-[1.55] md:flex md:min-h-0 md:flex-1 md:flex-col">
      <PageHead
        title={L("title")}
        lead={L("lead")}
        actions={
          write && (
            <button
              type="button"
              className="btn btn-outline h-9 text-[13px]"
              onClick={() => setAdding(true)}
            >
              {t("contracts.vgaps.company.add")}
            </button>
          )
        }
      />
      {adding && <AddCompanyDialog onClose={() => setAdding(false)} />}
      <MineBanner />
      <TableTools q={tb.q} setQ={tb.setQ} total={tb.total} placeholder={L("search")}>
        <fieldset
          aria-label={L("roleFilter")}
          className="m-0 flex min-w-0 flex-wrap gap-1.5 border-0 p-0"
        >
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              className="chip"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {L(`filter.${f}`)}
            </button>
          ))}
        </fieldset>
      </TableTools>
      <Panel className="md:flex md:min-h-0 md:flex-1 md:flex-col">
        {body()}
        <Pager t={tb} />
      </Panel>
      <p className="mt-4 text-[13px] text-dim">
        {L("foot")}{" "}
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
