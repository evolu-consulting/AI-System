// CR-139 · Q13 · «Sơ đồ tổ chức» (/contracts/org): CR-142 sơ đồ cây (organization chart) Công ty → phòng → phòng con; bấm thẻ ⇒ thành viên, tìm ⇒ nhảy tới phòng; ai trong công ty cũng xem, chỉ xem.

import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { PageHead, Panel } from "~/components/shared/layout";
import { Btn } from "~/components/ui/Btn";
import { Skeleton } from "~/components/ui/skeleton";
import { fetchOrgChart, orgChartKey } from "../api";
import { EditChartButton } from "../components/EditChartButton";
import { OrgChartBody } from "../components/OrgChartBody";

export function OrgChartPage() {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: orgChartKey,
    queryFn: ({ signal }) => fetchOrgChart(signal),
    retry: false,
    staleTime: 60_000,
  });
  return (
    <div data-testid="org-chart">
      <PageHead
        title={t("contracts.orgChart.title")}
        lead={t("contracts.orgChart.lead")}
        actions={<EditChartButton />}
      />
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
      ) : (q.data?.departments.length ?? 0) === 0 ? (
        <Panel className="px-6 py-10 text-center">
          <div data-testid="org-empty">
            <p className="text-body font-semibold">{t("contracts.orgChart.emptyTitle")}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-dim">
              {t("contracts.orgChart.emptyBody")}
            </p>
          </div>
        </Panel>
      ) : (
        <OrgChartBody departments={q.data?.departments ?? []} />
      )}
    </div>
  );
}
