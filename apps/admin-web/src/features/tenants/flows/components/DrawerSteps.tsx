// CR-121 c11 · Q1/Q11 · các bước của quy trình đang dùng: CANVAS mặc định, danh sách là chế độ phụ (nút icon có nhãn khi rê chuột, nhớ theo người dùng).
// Bản thư viện: CHỈ XEM + "Sao chép cho công ty này"; bản riêng của công ty: "Mở trình sửa".
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { FlowRowsView } from "@/features/apps/components/SlotFlowView";
import { ViewModeToggle } from "@/features/processes/components/ViewModeToggle";
import { useViewMode } from "@/features/processes/hooks/use-view-mode";
import { ApiError } from "@/lib/http";
import { defStepsQuery, useLibraryView } from "../api";
import { useFlowAssign } from "../hooks/use-flow-assign";

function StepActions(p: {
  tenantId: string;
  defId: string | null;
  copyId: string | null;
  hasLibrary: boolean;
  canCopy: boolean;
  pending: boolean;
  onCopy: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-2">
      {p.defId && p.canCopy ? (
        <Button size="sm" disabled={p.pending} data-testid="flows-copy" onClick={p.onCopy}>
          {t("tenants.flows.copy")}
        </Button>
      ) : null}
      {p.defId && p.hasLibrary ? (
        <Button size="sm" variant="ghost" asChild>
          <Link
            to="/processes/$processId"
            params={{ processId: p.defId }}
            search={{ company: p.tenantId }}
            data-testid="flows-open-detail"
          >
            {t("tenants.flows.openDetail")}
          </Link>
        </Button>
      ) : null}
      {p.copyId ? (
        <Button size="sm" variant="outline" asChild>
          <Link
            to="/processes/$processId"
            params={{ processId: p.copyId }}
            data-testid="flows-open-editor"
          >
            {t("tenants.flows.openEditor")}
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
export function DrawerSteps({
  tenantId,
  slot,
  defId,
  isPlatform,
}: {
  tenantId: string;
  slot: string;
  /** `null` = việc chưa có quy trình: vẫn hiện công tắc Sơ đồ/Danh sách (không phụ thuộc dữ liệu vừa tải lại). */
  defId: string | null;
  isPlatform: boolean;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useViewMode();
  const steps = useQuery({ ...defStepsQuery(tenantId, slot, defId ?? ""), enabled: !!defId });
  const lib = useLibraryView(tenantId, defId, true);
  const act = useFlowAssign(tenantId, slot, isPlatform);
  // Bản riêng của công ty (không phải thư viện) ⇒ 422 NOT_LIBRARY_DEF ⇒ sửa thẳng.
  const isCopy =
    !!defId && lib.error instanceof ApiError && String(lib.error.code) === "NOT_LIBRARY_DEF";
  const copyId = isCopy ? defId : (lib.data?.company_copy?.def_id ?? null);
  return (
    <section className="space-y-3" aria-label={t("tenants.flows.stepsTitle")}>
      <div className="flex items-center gap-2">
        <h3 className="text-label font-semibold">{t("tenants.flows.stepsTitle")}</h3>
        <span className="ml-auto" />
        <ViewModeToggle mode={mode} set={setMode} />
      </div>
      {defId ? (
        <FlowRowsView
          rows={steps.data?.steps ?? null}
          pending={steps.isPending}
          error={steps.error}
          view={mode}
        />
      ) : (
        <p className="text-caption text-muted-foreground">{t("tenants.flows.noneChosen")}</p>
      )}
      {lib.data && !isCopy ? (
        <p className="text-caption text-muted-foreground" data-testid="flows-library-readonly">
          {t(lib.data.company_copy ? "tenants.flows.hasCopy" : "tenants.flows.libraryReadOnly")}
        </p>
      ) : null}
      {isCopy && lib.error ? (
        <p className="text-caption text-muted-foreground">{t("tenants.flows.ownCopy")}</p>
      ) : null}
      <StepActions
        tenantId={tenantId}
        defId={defId}
        copyId={copyId}
        hasLibrary={!!lib.data}
        canCopy={!!lib.data && !lib.data.company_copy}
        pending={act.pending}
        onCopy={() => defId && void act.copy(defId)}
      />
    </section>
  );
}
