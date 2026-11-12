// CR-139 · Q13 · «Sơ đồ tổ chức» (/contracts/org): cây phòng ban + trưởng phòng + thành viên, tìm người; ai trong công ty cũng xem, chỉ xem.
import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHead, Panel } from "~/components/shared/layout";
import { TruncText } from "~/components/shared/TruncText";
import { Btn } from "~/components/ui/Btn";
import { Skeleton } from "~/components/ui/skeleton";
import { fetchOrgChart, orgChartKey } from "../api";
import { buildOrgTree, filterOrg, headcount, type OrgNode } from "../lib/org-tree";

function Dept({ n, depth }: { n: OrgNode; depth: number }) {
  const { t } = useTranslation();
  const others = n.members.filter((m) => m.id !== n.head?.id);
  return (
    <li
      data-testid={`org-dept-${n.id}`}
      className={depth > 0 ? "ml-5 border-l border-rule-soft pl-4" : ""}
    >
      <div className="rounded-lg border border-rule bg-panel px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="min-w-0 text-body font-semibold">
            <TruncText maxWidth="24rem">{n.name}</TruncText>
          </h3>
          <span className="text-caption text-dim">
            {t("contracts.orgChart.people", { count: headcount(n) })}
          </span>
        </div>
        <p className="mt-1 text-sm" data-testid="org-head">
          <span className="text-dim">{t("contracts.orgChart.head")}: </span>
          {n.head ? (
            <b>{n.head.name}</b>
          ) : (
            <span className="text-dim">{t("contracts.orgChart.noHead")}</span>
          )}
        </p>
        {others.length > 0 ? (
          <p className="mt-1 text-sm text-dim" data-testid="org-members">
            {others.map((m) => m.name).join(" · ")}
          </p>
        ) : null}
      </div>
      {n.children.length > 0 ? (
        <ul className="mt-2 space-y-2">
          {n.children.map((c) => (
            <Dept key={c.id} n={c} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function OrgChartPage() {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: orgChartKey,
    queryFn: ({ signal }) => fetchOrgChart(signal),
    retry: false,
    staleTime: 60_000,
  });
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const tree = useMemo(() => buildOrgTree(q.data?.departments ?? []), [q.data]);
  const shown = useMemo(() => filterOrg(tree, deferred), [tree, deferred]);
  return (
    <div data-testid="org-chart">
      <PageHead title={t("contracts.orgChart.title")} lead={t("contracts.orgChart.lead")} />
      {q.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : q.isError ? (
        <Panel className="px-6 py-8 text-center">
          <p role="alert" className="text-sm text-late" data-testid="org-error">
            {t("contracts.orgChart.loadError")}
          </p>
          <Btn variant="outline" className="mt-3" onClick={() => void q.refetch()}>
            {t("contracts.orgChart.retry")}
          </Btn>
        </Panel>
      ) : tree.length === 0 ? (
        <Panel className="px-6 py-10 text-center">
          <div data-testid="org-empty">
            <p className="text-body font-semibold">{t("contracts.orgChart.emptyTitle")}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-dim">
              {t("contracts.orgChart.emptyBody")}
            </p>
          </div>
        </Panel>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2">
            <label className="sr-only" htmlFor="org-search">
              {t("contracts.orgChart.search")}
            </label>
            <input
              id="org-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("contracts.orgChart.search")}
              className="h-10 w-full max-w-sm rounded-md border border-rule bg-panel px-3 text-body"
            />
            {query ? (
              <Btn variant="quiet" onClick={() => setQuery("")}>
                {t("contracts.orgChart.clear")}
              </Btn>
            ) : null}
          </div>
          {shown.length === 0 ? (
            <p className="text-sm text-dim" data-testid="org-no-match">
              {t("contracts.orgChart.noMatch", { q: deferred })}
            </p>
          ) : (
            <ul className="space-y-2" data-testid="org-tree">
              {shown.map((n) => (
                <Dept key={n.id} n={n} depth={0} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
