// ADM-FR-74 · hành động trên công ty đối tác: thêm, đổi tên (hộp thoại tên), vô hiệu (xác nhận, không hoàn tác).
import type { ExternalOrg } from "@ai/contracts";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { notifySuccess } from "@/components/shared/toast";
import { useCreateOrg, useDeactivateOrg, useRenameOrg } from "../api";
import { PartnerNameDialog } from "../components/PartnerNameDialog";
import { useReportError } from "./use-report-error";

type NameTarget = { mode: "create" } | { mode: "rename"; org: ExternalOrg };

export function useOrgActions(tenantId: string | undefined): {
  openCreate: () => void;
  rename: (org: ExternalOrg) => void;
  deactivate: (org: ExternalOrg) => void;
  dialogs: ReactNode;
} {
  const { t } = useTranslation();
  const report = useReportError();
  const create = useCreateOrg(tenantId);
  const renameOrg = useRenameOrg();
  const deactivateOrg = useDeactivateOrg();
  const [nameTarget, setNameTarget] = useState<NameTarget | null>(null);
  const [toDeactivate, setToDeactivate] = useState<ExternalOrg | null>(null);

  const submitName = async (name: string) => {
    if (!nameTarget) return;
    if (nameTarget.mode === "create") {
      const org = await create.mutateAsync({ name });
      notifySuccess(t("partners.toast.created", { name: org.name }));
    } else {
      const org = await renameOrg.mutateAsync({ id: nameTarget.org.id, name });
      notifySuccess(t("partners.toast.renamed", { name: org.name }));
    }
    setNameTarget(null);
  };

  const confirmDeactivate = async () => {
    const org = toDeactivate;
    if (!org) return;
    await deactivateOrg.mutateAsync(org.id).catch((err: unknown) => {
      report(err);
      throw err; // giữ hộp thoại mở
    });
    notifySuccess(t("partners.toast.deactivated", { name: org.name }));
  };

  const dialogs = (
    <>
      {nameTarget ? (
        <PartnerNameDialog
          mode={nameTarget.mode}
          initial={nameTarget.mode === "rename" ? nameTarget.org.name : ""}
          onSubmit={submitName}
          onError={report}
          onClose={() => setNameTarget(null)}
        />
      ) : null}
      <ConfirmDialog
        open={toDeactivate !== null}
        onOpenChange={(open) => !open && setToDeactivate(null)}
        title={t("partners.deactivate.title", { name: toDeactivate?.name ?? "" })}
        description={t("partners.deactivate.body")}
        confirmLabel={t("partners.deactivate.submit")}
        destructive
        onConfirm={confirmDeactivate}
      />
    </>
  );
  return {
    openCreate: () => setNameTarget({ mode: "create" }),
    rename: (org) => setNameTarget({ mode: "rename", org }),
    deactivate: setToDeactivate,
    dialogs,
  };
}
