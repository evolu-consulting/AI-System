// CR-118 · cr118-app-config · tab "Quy trình" của app: mỗi khe một thẻ (SlotCard). Dùng thư viện CR-105; chỉnh sửa mở trình soạn quy trình duy nhất.
import type { AppSlotDecl } from "@ai/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { LoadingState } from "@/components/shared/states/LoadingState";
import { CloneDialog } from "@/features/processes/components/library/CloneDialog";
import { useCloneFlow } from "@/features/processes/hooks/use-clone-flow";
import { loadError } from "@/lib/load-error";
import type { useAppProcesses } from "../../hooks/use-app-processes";
import { slotRows } from "../../lib/slot-rows";
import { SlotCard } from "../SlotCard";
import { MissingSlotCard } from "../SlotDeclInfo";

type Props = {
  data: ReturnType<typeof useAppProcesses>;
  /** CR-120 · khe khai báo trong manifest app (vắng ⇒ chỉ khe hub). */
  decls?: readonly AppSlotDecl[] | undefined;
  onOpenCompanies: () => void;
};

export function ProcessesTab({ data, decls = [], onOpenCompanies }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const clone = useCloneFlow(
    (id) => void navigate({ to: "/processes/$processId", params: { processId: id } }),
  );
  const err = loadError(data.error);
  if (!data.configured) return <EmptyState message={t("appcfg.processes.noHub")} />;
  if (err) return <ErrorState message={err.message} code={err.code} onRetry={data.refetch} />;
  if (data.pending) return <LoadingState />;
  const rows = slotRows(decls, data.views);
  if (rows.length === 0) return <EmptyState message={t("appcfg.processes.noSlots")} />;
  return (
    <div className="space-y-4">
      <p className="text-caption text-muted-foreground">{t("appcfg.processes.intro")}</p>
      {rows.map((r) =>
        r.view ? (
          <SlotCard
            key={r.key}
            view={r.view}
            decl={r.decl}
            onClone={clone.open}
            onOpenCompanies={onOpenCompanies}
          />
        ) : r.decl ? (
          <MissingSlotCard key={r.key} decl={r.decl} />
        ) : null,
      )}
      <CloneDialog
        src={clone.src}
        pending={clone.pending}
        error={clone.error}
        onSubmit={(n) => void clone.submit(n)}
        onClose={clone.close}
      />
    </div>
  );
}
