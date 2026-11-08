// CR-125 · cr125-manual-start-ui · «Tạo yêu cầu»: loại yêu cầu người xem được bắt đầu (`GET /processes/startable`) + việc chờ tôi duyệt
// (`GET /me/review-tasks`). Rỗng ⇒ nói vì sao và nhờ ai.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHead, Panel } from "~/components/shared/layout";
import { Skeleton } from "~/components/ui/skeleton";
import { fetchMyTasks, fetchStartable, requestKeys } from "../api";

export function RequestsPage() {
  const { t } = useTranslation();
  const flows = useQuery({
    queryKey: requestKeys.startable,
    queryFn: ({ signal }) => fetchStartable(signal),
    staleTime: 30_000,
  });
  const tasks = useQuery({
    queryKey: requestKeys.tasks,
    queryFn: ({ signal }) => fetchMyTasks(signal),
    retry: false,
  });
  const mine = (tasks.data?.items ?? []).filter((i) => i.task.status === "open" && i.task.can_act);
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
                  <span className="shrink-0 text-label text-dim">
                    {t("contracts.requests.fields", { n: f.form.fields.length })}
                  </span>
                  <span className="btn btn-primary btn-sm">{t("contracts.requests.open")}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <h2 className="mb-2 mt-6 text-[15px] font-semibold">
        {t("contracts.requests.waitingTitle")}
      </h2>
      {mine.length === 0 ? (
        <p className="text-sm text-dim" data-testid="requests-waiting-empty">
          {t("contracts.requests.waitingEmpty")}
        </p>
      ) : (
        <Panel>
          <ul data-testid="requests-waiting" className="m-0 list-none p-0">
            {mine.map((i) => (
              <li key={i.task.id} className="border-b border-rule-soft last:border-b-0">
                <Link
                  to="/contracts/requests/$runId"
                  params={{ runId: i.process_run.id }}
                  data-testid="requests-waiting-row"
                  className="flex min-w-0 items-center gap-3 px-5 py-3 max-sm:px-4"
                >
                  <b className="min-w-0 flex-1 truncate text-[14.5px] font-semibold">
                    {i.process_run.process.name}
                  </b>
                  <span className="shrink-0 text-label text-dim">{i.task.stage_name}</span>
                  <span className="text-sm font-medium text-act">
                    {t("contracts.requests.waitingOpen")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
