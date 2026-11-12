// CR-121 c17 · Q1/Q9/Q11 · quy trình THƯ VIỆN mở từ Công ty › Quy trình: CHỈ XEM (sơ đồ mặc định, danh sách bước là chế độ phụ).
// CR-127 · Z5: không còn "Sao chép cho công ty này" — chỉ quản trị nền tảng soạn; bản riêng đã có (dữ liệu cũ) vẫn mở được.

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { DataTable } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { HubLoadError } from "@/components/shared/states/HubLoadError";
import { LoadingState } from "@/components/shared/states/LoadingState";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FlowRowsView } from "@/features/apps/components/SlotFlowView";
import { rowsFromSlotBody } from "@/features/apps/lib/flow-view";
import { useLibraryView } from "@/features/tenants/flows/api";
import { isApiError } from "@/lib/errors";
import { useViewMode } from "../../hooks/use-view-mode";
import { companySearch } from "../../lib/company-copy";
import { libraryFlowOf } from "../../lib/library-flow";
import { runColumns } from "../editor/EditorRunsTab";
import { ViewModeToggle } from "../ViewModeToggle";
import { LibraryFlowCanvas } from "./LibraryFlowCanvas";

type Props = { tenantId: string; defId: string; fallback: ReactNode };

/** Không phải quy trình thư viện (không thấy ⇒ 404) ⇒ để trình sửa/NotFound xử lý. */
const notLibrary = (e: unknown): boolean => isApiError(e) && e.status === 404;

export function LibraryReadOnlyView({ tenantId, defId, fallback }: Props) {
  const { t } = useTranslation();
  const q = useLibraryView(tenantId, defId, true);
  const [mode, setMode] = useViewMode();
  if (q.isPending) return <LoadingState />;
  if (notLibrary(q.error)) return <>{fallback}</>;
  if (q.isError || !q.data)
    return (
      <HubLoadError message={t("process.common.error.load")} onRetry={() => void q.refetch()} />
    );
  const v = q.data;
  const flow = libraryFlowOf(v);
  const rows = flow ? null : rowsFromSlotBody(v.slot_body);
  const copyId = v.company_copy?.def_id ?? null;
  return (
    <div className="space-y-4" data-testid="library-readonly">
      <PageHeader
        title={v.name}
        description={t("process.admin.editor.kind", { kind: v.slot_label, n: v.rel_version })}
      />
      <Alert className="flex flex-wrap items-center gap-3">
        <AlertDescription className="flex-1">
          <strong>{t("process.admin.editor.libReadonly")}</strong>{" "}
          {t(v.company_copy ? "tenants.flows.hasCopy" : "tenants.flows.libraryReadOnly")}
        </AlertDescription>
        {copyId ? (
          <Button asChild data-testid="library-open-copy">
            <Link
              to="/processes/$processId"
              params={{ processId: copyId }}
              search={companySearch(tenantId)}
            >
              {t("process.admin.editor.openCopy")}
            </Link>
          </Button>
        ) : null}
      </Alert>
      <Tabs defaultValue="steps">
        <TabsList>
          <TabsTrigger value="steps">{t("process.admin.editor.stepsTab")}</TabsTrigger>
          <TabsTrigger value="runs">{t("process.admin.editor.tab.runs")}</TabsTrigger>
        </TabsList>
        <TabsContent value="steps">
          <section className="space-y-3" aria-label={t("tenants.flows.stepsTitle")}>
            {flow ? (
              <>
                <h2 className="text-label font-semibold">{t("tenants.flows.stepsTitle")}</h2>
                <LibraryFlowCanvas flow={flow} tenantId={tenantId} />
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <h2 className="text-label font-semibold">{t("tenants.flows.stepsTitle")}</h2>
                  <span className="ml-auto" />
                  <ViewModeToggle mode={mode} set={setMode} />
                </div>
                <FlowRowsView rows={rows} pending={false} error={null} view={mode} />
              </>
            )}
          </section>
        </TabsContent>
        <TabsContent value="runs">
          {/* chỉ lượt của CÔNG TY NÀY chạy đúng quy trình này (Hub lọc theo def_id + công ty) */}
          <DataTable
            caption={t("process.admin.editor.tab.runs")}
            columns={runColumns(t, tenantId)}
            rows={v.runs}
            getRowKey={(r) => r.id}
            isLoading={false}
            empty={<EmptyState message={t("process.admin.editor.runs.empty")} />}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
