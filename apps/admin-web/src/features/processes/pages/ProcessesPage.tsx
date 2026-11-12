import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { LazyConflictDialog } from "@/components/shared/conflict/LazyConflictDialog";
import { HubNotConfigured } from "@/components/shared/states/HubLoadError";
import { hubConfigured } from "@/lib/hub";
import { CompanyFlowsOverview } from "../components/CompanyFlowsOverview";
import { CloneDialog } from "../components/library/CloneDialog";
import { ProcessesHeader } from "../components/ProcessesHeader";
import { ProcessRouteGate } from "../components/ProcessRouteGate";
import { RunDialog } from "../components/RunDialog";
import { type ProcessesView, type Tab, useProcessesView } from "../hooks/use-processes-view";

/** Thư viện platform (chưa chọn công ty): giữ hai tab Thư viện / Mẫu · chạy thử như cũ. */
/** CR-127 · U2 · M8: gỡ tab «Mẫu có sẵn» (AI-SDLC, đều Tắt) — chỉ còn danh sách Thư viện. */
function LibraryTabs({ v }: { v: ProcessesView }) {
  const { setTab } = v;
  useEffect(() => {
    if (v.tab === "templates") setTab("own" as Tab);
  }, [v.tab, setTab]);
  if (v.tab !== "own") return null;
  // CR-127 · M1: chỉ danh sách quy trình THEO CÔNG TY (Thư viện mẫu ẩn khỏi ai-admin — người dùng chốt: chỉ tạo sơ đồ trống)
  return <CompanyFlowsOverview />;
}

function ListPage() {
  const { t } = useTranslation();
  const v = useProcessesView();
  const hub = hubConfigured();
  if (!v.tenant.me) return null;
  return (
    <>
      <ProcessesHeader v={v} />
      {hub ? <LibraryTabs v={v} /> : <HubNotConfigured />}
      <RunDialog row={v.runRow} tenantId={v.tenant.tenantId} onClose={v.closeRun} />
      <ConfirmDialog
        open={v.delRow !== null}
        onOpenChange={(o) => !o && v.closeDelete()}
        title={t("process.admin.list.delete.title")}
        description={t("process.admin.list.delete.body", { name: v.delRow?.name ?? "" })}
        confirmLabel={t("process.admin.list.deleteButton")}
        destructive
        level="heavy"
        confirmText={v.delRow?.name}
        typePrompt={t("process.admin.list.delete.prompt")}
        onConfirm={v.confirmDelete}
      />
      <CloneDialog
        src={v.cloneFlow.src}
        pending={v.cloneFlow.pending}
        error={v.cloneFlow.error}
        onSubmit={(n) => void v.cloneFlow.submit(n)}
        onClose={v.cloneFlow.close}
      />
      <LazyConflictDialog props={v.conflictProps} />
    </>
  );
}

export function ProcessesPage() {
  return (
    <ProcessRouteGate>
      <ListPage />
    </ProcessRouteGate>
  );
}
