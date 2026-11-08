// CR-125 · «Yêu cầu» (CR-126 đổi tên): loại yêu cầu người xem được bắt đầu (`GET /processes/startable`). Rỗng ⇒ nói vì sao và nhờ ai.
// Việc chờ tôi nằm ở MỘT hộp: «Việc của tôi».
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHead, Panel } from "~/components/shared/layout";
import { Skeleton } from "~/components/ui/skeleton";
import { fetchStartable, requestKeys } from "../api";
import { MyRequests } from "../components/MyRequests";

export function RequestsPage() {
  const { t } = useTranslation();
  const flows = useQuery({
    queryKey: requestKeys.startable,
    queryFn: ({ signal }) => fetchStartable(signal),
    staleTime: 30_000,
  });
  return (
    <div data-testid="requests-page">
      <PageHead title={t("contracts.requests.title")} lead={t("contracts.requests.lead")} />
      {flows.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : flows.isError ? (
        <p role="alert" className="text-sm text-late">
          {t("contracts.requests.loadError")}
        </p>
      ) : flows.data.items.length === 0 ? (
        <Panel className="px-6 py-10 text-center">
          <div data-testid="requests-empty">
            <p className="text-body font-semibold">{t("contracts.requests.empty")}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-dim">
              {t("contracts.requests.emptyBody")}
            </p>
          </div>
        </Panel>
      ) : (
        <Panel>
          <ul data-testid="startable-list" className="m-0 list-none p-0">
            {flows.data.items.map((f) => (
              <li key={f.flow_key} className="border-b border-rule-soft last:border-b-0">
                <Link
                  to="/contracts/requests/new/$flowKey"
                  params={{ flowKey: f.flow_key }}
                  data-testid="startable-flow"
                  className="flex min-w-0 items-center gap-3 px-5 py-3 max-sm:px-4"
                >
                  <b className="min-w-0 flex-1 truncate text-[14.5px] font-semibold">{f.name}</b>
                  {f.description ? (
                    <span className="min-w-0 max-w-[40%] truncate text-label text-dim">
                      {f.description}
                    </span>
                  ) : null}
                  <span className="btn btn-primary btn-sm">{t("contracts.requests.open")}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <MyRequests />
    </div>
  );
}
