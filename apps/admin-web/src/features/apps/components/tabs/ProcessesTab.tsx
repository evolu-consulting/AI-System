// CR-118 · cr118-app-config · tab "Quy trình" của app: mỗi khe một thẻ (SlotCard). Dùng thư viện CR-105; chỉnh sửa mở trình soạn quy trình duy nhất.
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { LoadingState } from "@/components/shared/states/LoadingState";
import { CloneDialog } from "@/features/processes/components/library/CloneDialog";
import { useCloneFlow } from "@/features/processes/hooks/use-clone-flow";
import { loadError } from "@/lib/load-error";
import type { useAppProcesses } from "../../hooks/use-app-processes";
import { SlotCard } from "../SlotCard";

type Props = { data: ReturnType<typeof useAppProcesses>; onOpenCompanies: () => void };

export function ProcessesTab({ data, onOpenCompanies }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const clone = useCloneFlow(
    (id) => void navigate({ to: "/processes/$processId", params: { processId: id } }),
  );
  const err = loadError(data.error);
  if (!data.configured) return <EmptyState message={t("appcfg.processes.noHub")} />;
  if (err) return <ErrorState message={err.message} code={err.code} onRetry={data.refetch} />;
  if (data.pending) return <LoadingState />;
  if (data.views.length === 0) return <EmptyState message={t("appcfg.processes.noSlots")} />;
  return (
    <div className="space-y-4">
      <p className="text-caption text-muted-foreground">{t("appcfg.processes.intro")}</p>
      {data.views.map((v) => (
        <SlotCard
          key={v.slot.slot}
          view={v}
          onClone={clone.open}
          onOpenCompanies={onOpenCompanies}
        />
      ))}
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
