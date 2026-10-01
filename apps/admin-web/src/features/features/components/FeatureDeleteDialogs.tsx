// ADM-FR-30 · M2-R21 · hộp thoại xoá feature: chặn (liệt kê command độc quyền) hoặc xác nhận nặng (gõ key).
import type { FeatureListItem } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { BlockedDialog } from "@/components/shared/BlockedDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { DependencyList } from "@/components/shared/DependencyList";
import type { CommandRef } from "../lib/exclusive";

export type PendingBlock = { feature: FeatureListItem; commands: CommandRef[] };

type Props = {
  blocked: PendingBlock | null;
  toDelete: FeatureListItem | null;
  nameOf: (f: FeatureListItem) => string;
  onCloseBlocked: () => void;
  onCloseDelete: () => void;
  onConfirm: () => Promise<void>;
};

export function FeatureDeleteDialogs(p: Props) {
  const { t } = useTranslation();
  const { blocked, toDelete, nameOf } = p;
  return (
    <>
      <BlockedDialog
        open={!!blocked}
        onClose={p.onCloseBlocked}
        title={t("features.delete.blocked", { feature: blocked ? nameOf(blocked.feature) : "" })}
      >
        <DependencyList
          sections={[
            {
              title: t("common.dependency.command"),
              items: (blocked?.commands ?? []).map((c) => ({
                id: c.id,
                label: `/${c.name}`,
                mono: true,
                href: `/commands/${c.id}`,
              })),
            },
          ]}
        />
      </BlockedDialog>
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(open) => !open && p.onCloseDelete()}
        title={t("features.delete.title", { feature: toDelete ? nameOf(toDelete) : "" })}
        confirmLabel={t("features.delete.submit")}
        destructive
        level="heavy"
        confirmText={toDelete?.key}
        typePrompt={t("features.delete.typeToConfirm", { key: toDelete?.key ?? "" })}
        onConfirm={p.onConfirm}
      />
    </>
  );
}
