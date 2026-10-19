// HUB-FR-113 · CHAT-AC-54…56 · PF3: trang `/runs/$id?tab&task`. Tabs Tiến độ / Token / Nhật ký ("Nhật ký" ẩn khi
// `access:"task"`). 404 (gồm không có quyền) ⇒ "Không tìm thấy". Token tab = chỗ dành cho PF4 (`UsageTab`, lười).

import { ApiError } from "@ai/web-kit/http";
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "~/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { ProcessNotFound } from "../../shared/components/ProcessRouteGate";
import { useProcessRun } from "../../shared/hooks/use-process-run";
import { LogTab } from "./LogTab";
import { ProgressTab } from "./ProgressTab";
import { RunHeader } from "./RunHeader";

// Tab "Token" (F4b/PF4): để chỗ, không hiện thực ở PF3; thiếu trên nhánh này cũng không vỡ (stub trả null).
const UsageTab = lazy(() =>
  import("../../usage/components/UsageTab").then((m) => ({ default: m.UsageTab })),
);

export type RunPageProps = { runId: string; taskId?: string; tab?: "progress" | "token" | "log" };

export function RunPage({ runId, tab: initialTab }: RunPageProps) {
  const { t } = useTranslation();
  const q = useProcessRun(runId);
  const [tab, setTab] = useState<string>(initialTab ?? "progress");

  if (q.isPending) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-4" aria-busy="true">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (q.isError) {
    if (q.error instanceof ApiError && q.error.status === 404) return <ProcessNotFound />;
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p role="alert" className="text-sm text-destructive">
          {t("process.common.error.load")}
        </p>
        <button
          type="button"
          className="rounded-md border border-input px-3 py-1.5 text-sm font-medium hover:bg-muted"
          onClick={() => void q.refetch()}
        >
          {t("process.common.error.retry")}
        </button>
      </div>
    );
  }

  const view = q.data;
  const isFull = view.access === "full";

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <RunHeader view={view} onCancelled={() => void q.refetch()} />
      <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 overflow-hidden">
        <TabsList className="px-4">
          <TabsTrigger value="progress">{t("process.inbox.run.tab.progress")}</TabsTrigger>
          <TabsTrigger value="token">{t("process.inbox.run.tab.token")}</TabsTrigger>
          {isFull && <TabsTrigger value="log">{t("process.inbox.run.tab.log")}</TabsTrigger>}
        </TabsList>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TabsContent value="progress">
            <ProgressTab view={view} />
          </TabsContent>
          <TabsContent value="token">
            <Suspense fallback={<Skeleton className="m-4 h-24" />}>
              <UsageTab runId={runId} />
            </Suspense>
          </TabsContent>
          {isFull && (
            <TabsContent value="log">
              <LogTab view={view} />
            </TabsContent>
          )}
        </div>
      </Tabs>
    </div>
  );
}
