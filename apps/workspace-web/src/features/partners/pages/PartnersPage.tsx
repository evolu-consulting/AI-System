// V2-I · DT-01 · S-p02 `/partners` v2 — mockup NITI: mỗi đối tác một dòng (tên, các vai, điểm từng vai, số hợp đồng), tìm + lọc vai /
// "Cần chú ý"; bấm tên mở trang chi tiết. Huy hiệu MỚI · tạm tính + cờ đỏ (U3); "+ Ghi việc" (sổ HD7) giữ lại.
// CR-151e: tìm / lọc / sắp xếp / cắt trang + gộp vai + điểm + số HĐ chạy Ở MÁY CHỦ (`GET /partners/page`, cả hai engine) — chỉ tải trang đang xem.

import type { PartnerRole, RepRole } from "@ai/contracts/pack-contracts";
import { Button } from "@ai/web-kit/ui/kit/button";
import { FilterBar } from "@ai/web-kit/ui/kit/filter-bar";
import { ICONS } from "@ai/web-kit/ui/kit/icons";
import { PageHeader } from "@ai/web-kit/ui/kit/page-header";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Panel } from "~/components/shared/layout";
import { Empty, ErrorLine, Loading } from "~/components/shared/states";
import { PartnerLog } from "~/features/ledger/components/PartnerLog";
import { useMe } from "~/features/pack-state/hooks/use-me";
import { Pager, TableTools } from "~/features/table";
import { cn } from "~/lib/utils";
import { AddCompanyDialog } from "../components/AddCompanyDialog";
import { ConnectSearchDialog } from "../components/ConnectSearchDialog";
import { DiscoverableCard } from "../components/DiscoverableCard";
import { MineBanner } from "../components/MineBanner";
import { PendingRequestsCard } from "../components/PendingRequestsCard";
import { RedFlagTag } from "../components/RedFlagTag";
import { RepBadge } from "../components/RepBadge";
import { usePartyPage } from "../hooks/use-partner-scores";
import { useEngine } from "../hooks/use-rep-v2e";
import type { PartyItem } from "../lib/partner-score";
import { REP_ROLE_ORDER, ROLES } from "../lib/partner-v2";

type Filter = "all" | RepRole | "watch" | "flag";
/** HD8: hai vai có điểm; V2-E: thêm bên trả hoa hồng (R23). */
const filtersOf = (v2e: boolean): readonly Filter[] => [
  "all",
  ...(v2e ? REP_ROLE_ORDER : ROLES),
  "watch",
  "flag",
];
const isLoggable = (r: { role: RepRole }): r is { role: PartnerRole } =>
  r.role === "customer" || r.role === "supplier";

function Row({ p, open, setOpen }: { p: PartyItem; open: boolean; setOpen: (v: boolean) => void }) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.pv2.${k}`, o);
  const { write } = useMe();
  const loggable = p.roles.find(isLoggable);
  return (
    <li
      className={cn(
        "border-b border-rule-soft last:border-0",
        p.red_flag ? "bg-late-bg/40" : p.worst === "watch" && "bg-soon-bg/50",
      )}
    >
      {/* Điện thoại: chừa cột phải cho nút trợ lý nổi (48 px + lề) để tên/nút của dòng không nằm dưới nó, dù dòng rơi vào đúng độ cao của nút (luật R4). */}
      <div className="flex flex-wrap items-center gap-4 px-5 py-3.5 max-sm:pe-16">
        <span className="flex shrink-0 gap-2">
          {p.roles.map((r) => (
            <RepBadge key={r.role} row={r} role={r.role} />
          ))}
        </span>
        <span className="min-w-0 flex-1 basis-56">
          <Link
            to="/contracts/partners"
            search={{ party: p.party }}
            className="block truncate font-semibold text-ink hover:text-act hover:underline max-sm:-my-3 max-sm:py-3"
          >
            {p.name}
          </Link>
          {p.red_flag && <RedFlagTag flags={p.red_flags} />}
          <span className="block truncate text-[13px] text-dim">
            {p.roles.map((r) => L(`roleWord.${r.role}`)).join(" · ")} ·{" "}
            {L("contractsN", { n: p.contracts })}
          </span>
        </span>
        <span className="ml-auto flex shrink-0 gap-1.5 max-sm:ml-0">
          {write && loggable && (
            <button
              type="button"
              className={cn(
                "btn h-9 text-[13px] max-sm:min-h-11",
                open ? "btn-outline" : "btn-quiet",
              )}
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              {open ? L("close") : L("log")}
            </button>
          )}
          <Link
            to="/contracts/partners"
            search={{ party: p.party }}
            className="btn btn-quiet h-9 text-[13px] max-sm:min-h-11"
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
  const { engine } = useEngine();
  const [filter, setFilter] = useState<Filter>("all");
  const [qRaw, setQRaw] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [finding, setFinding] = useState(false);
  const { write } = useMe();
  // tìm gõ trễ 250 ms rồi gọi máy chủ; đổi tìm/lọc ⇒ về trang 1
  useEffect(() => {
    const h = setTimeout(() => {
      setQ(qRaw.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(h);
  }, [qRaw]);
  const list = usePartyPage({ filter, q, limit: pageSize, offset: (page - 1) * pageSize });
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const pager = {
    page,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    setPage,
    total,
    pageSize,
    setPageSize: (n: number) => {
      setPageSize(n);
      setPage(1);
    },
  };
  const body = () => {
    if (list.isLoading) return <Loading />;
    if (list.error) return <ErrorLine error={list.error} />;
    if (!total && filter === "all" && !q)
      return <Empty title={L("emptyTitle")}>{L("emptyBody")}</Empty>;
    if (!total)
      return (
        <Empty kind="search" title={L("noMatchTitle")}>
          {L("noMatchBody")}
        </Empty>
      );
    return (
      <ul data-testid="partner-list">
        {items.map((p) => (
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
    <div className="text-base leading-[1.55]">
      <PageHeader
        className="mb-5"
        title={L("title")}
        description={L("lead")}
        primary={
          write && (
            <Button variant="primary" onClick={() => setAdding(true)}>
              {t("contracts.vgaps.company.add")}
            </Button>
          )
        }
        actions={[
          {
            label: t("contracts.connect.find"),
            icon: <ICONS.search className="size-4" aria-hidden="true" />,
            pinMobile: true,
            onSelect: () => setFinding(true),
          },
        ]}
      />
      {adding && <AddCompanyDialog onClose={() => setAdding(false)} />}
      {finding && <ConnectSearchDialog onClose={() => setFinding(false)} />}
      <MineBanner />
      <PendingRequestsCard />
      <DiscoverableCard />
      <TableTools q={qRaw} setQ={setQRaw} total={total} placeholder={L("search")}>
        <FilterBar
          className="min-w-0 max-sm:w-full"
          chips={
            <fieldset
              aria-label={L("roleFilter")}
              className="m-0 flex min-w-0 flex-wrap gap-1.5 border-0 p-0 max-sm:flex-nowrap"
            >
              {filtersOf(engine === "v2e").map((f) => (
                <button
                  key={f}
                  type="button"
                  className="chip max-sm:min-h-11 max-sm:shrink-0"
                  aria-pressed={filter === f}
                  onClick={() => {
                    setFilter(f);
                    setPage(1);
                  }}
                >
                  {L(`filter.${f}`)}
                </button>
              ))}
            </fieldset>
          }
        />
      </TableTools>
      <Panel>
        {body()}
        <Pager t={pager} />
      </Panel>
      <p className="mt-4 text-[13px] text-dim">
        {L("foot")}{" "}
        <Link
          to="/contracts/partners"
          className="tap-target font-semibold text-act underline underline-offset-2"
        >
          {L("howLink")}
        </Link>
      </p>
    </div>
  );
}
