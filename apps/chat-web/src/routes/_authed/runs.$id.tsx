// HUB-FR-113, CHAT-AC-54…56 · P-a: `/runs/:id?task=<taskId>` — trang lượt chạy (PF3 `RunPage`). Engine off ⇒ "Không tìm thấy".
import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ProcessRouteGate } from "~/features/processes/shared/components/ProcessRouteGate";

const RunPage = lazy(() =>
  import("~/features/processes/run-page/components/RunPage").then((m) => ({ default: m.RunPage })),
);

export type RunSearch = { task?: string; tab?: "progress" | "token" | "log" };

function RunRoute() {
  const { id } = Route.useParams();
  const { task, tab } = Route.useSearch();
  return (
    <ProcessRouteGate>
      <Suspense fallback={null}>
        <RunPage runId={id} taskId={task} tab={tab} />
      </Suspense>
    </ProcessRouteGate>
  );
}

export const Route = createFileRoute("/_authed/runs/$id")({
  validateSearch: (search: Record<string, unknown>): RunSearch => ({
    ...(typeof search.task === "string" && search.task !== "" ? { task: search.task } : {}),
    ...(search.tab === "progress" || search.tab === "token" || search.tab === "log"
      ? { tab: search.tab }
      : {}),
  }),
  component: RunRoute,
});
