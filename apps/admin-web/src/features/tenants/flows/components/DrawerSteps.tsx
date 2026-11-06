// CR-121 c11 · Q1/Q11 · các bước của quy trình đang dùng: CANVAS mặc định, danh sách là chế độ phụ (nút icon có nhãn khi rê chuột, nhớ theo người dùng).
// Bản thư viện: CHỈ XEM + "Sao chép cho công ty này"; bản riêng của công ty: "Mở trình sửa".
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { FlowRowsView } from "@/features/apps/components/SlotFlowView";
import { useViewMode } from "@/features/processes/hooks/use-view-mode";
import type { ViewMode } from "@/features/processes/lib/view-mode";
import { ApiError } from "@/lib/http";
import { defStepsQuery, useLibraryView } from "../api";
import { useFlowAssign } from "../hooks/use-flow-assign";

const MODES: readonly ViewMode[] = ["canvas", "list"];

function ModeToggle({ mode, set }: { mode: ViewMode; set: (m: ViewMode) => void }) {
  const { t } = useTranslation();
  return (
    <span role="toolbar" aria-label={t("tenants.flows.viewMode")} className="inline-flex gap-1">
      {MODES.map((m) => (
        <Button
          key={m}
          size="sm"
          variant={mode === m ? "secondary" : "ghost"}
          aria-pressed={mode === m}
          title={t(`tenants.flows.view.${m}`)}
          aria-label={t(`tenants.flows.view.${m}`)}
          data-testid={`flows-view-${m}`}
          onClick={() => set(m)}
        >
          <span aria-hidden>{m === "canvas" ? "◇" : "≡"}</span>
        </Button>
      ))}
    </span>
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
  defId: string;
  isPlatform: boolean;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useViewMode();
  const steps = useQuery(defStepsQuery(tenantId, slot, defId));
  const lib = useLibraryView(tenantId, defId, true);
  const act = useFlowAssign(tenantId, slot, isPlatform);
  // Bản riêng của công ty (không phải thư viện) ⇒ 422 NOT_LIBRARY_DEF ⇒ sửa thẳng.
  const isCopy = lib.error instanceof ApiError && String(lib.error.code) === "NOT_LIBRARY_DEF";
  const copyId = isCopy ? defId : (lib.data?.company_copy?.def_id ?? null);
  return (
    <section className="space-y-3" aria-label={t("tenants.flows.stepsTitle")}>
      <div className="flex items-center gap-2">
        <h3 className="text-label font-semibold">{t("tenants.flows.stepsTitle")}</h3>
        <span className="ml-auto" />
        <ModeToggle mode={mode} set={setMode} />
      </div>
      <FlowRowsView
        rows={steps.data?.steps ?? null}
        pending={steps.isPending}
        error={steps.error}
        view={mode}
      />
      {lib.data && !isCopy ? (
        <p className="text-caption text-muted-foreground" data-testid="flows-library-readonly">
          {t(lib.data.company_copy ? "tenants.flows.hasCopy" : "tenants.flows.libraryReadOnly")}
        </p>
      ) : null}
      {isCopy && lib.error ? (
        <p className="text-caption text-muted-foreground">{t("tenants.flows.ownCopy")}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {lib.data && !lib.data.company_copy ? (
          <Button
            size="sm"
            disabled={act.pending}
            data-testid="flows-copy"
            onClick={() => void act.copy(defId)}
          >
            {t("tenants.flows.copy")}
          </Button>
        ) : null}
        {copyId ? (
          <Button size="sm" variant="outline" asChild>
            <Link
              to="/processes/$processId"
              params={{ processId: copyId }}
              data-testid="flows-open-editor"
            >
              {t("tenants.flows.openEditor")}
            </Link>
          </Button>
        ) : null}
      </div>
    </section>
  );
}
