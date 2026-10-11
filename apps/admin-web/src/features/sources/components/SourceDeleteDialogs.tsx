// ADM-FR-68 · PB-R08 · hộp thoại xoá nguồn: chặn (liệt kê quy trình/giai đoạn đang dùng) hoặc xác nhận nhẹ (không bắt gõ lại tên:
// nguồn chỉ-đọc, xoá mềm — plan-frontend §2). Dòng liệt kê là link về danh sách quy trình (SourceInUseRef chỉ có `process_key`, không có id).
import { useTranslation } from "react-i18next";
import { BlockedDialog } from "@/components/shared/BlockedDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { DependencyList } from "@/components/shared/DependencyList";
import type { SourceRef } from "../lib/errors";

export type DeleteTarget = { key: string; version: number; refs: SourceRef[]; blocked: boolean };

type Props = {
  target: DeleteTarget | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
};

export function SourceDeleteDialogs({ target, onClose, onConfirm }: Props) {
  const { t } = useTranslation();
  const key = target?.key ?? "";
  return (
    <>
      <BlockedDialog
        open={!!target?.blocked}
        onClose={onClose}
        title={t("process.sources.delete.blockedTitle", { key })}
      >
        <p className="mb-3 text-body text-muted-foreground">
          {t("process.sources.delete.blockedBody")}
        </p>
        <DependencyList
          sections={[
            {
              title: t("process.sources.col.usedBy"),
              items: (target?.refs ?? []).map((r) => ({
                id: `${r.process_key}:${r.stage_key}`,
                label: t("process.sources.delete.ref", {
                  process: r.process_key,
                  stage: r.stage_key,
                }),
                href: "/processes",
              })),
            },
          ]}
        />
      </BlockedDialog>
      <ConfirmDialog
        open={!!target && !target.blocked}
        onOpenChange={(open) => !open && onClose()}
        title={t("process.sources.delete.title", { key })}
        description={t("process.sources.delete.body")}
        confirmLabel={t("process.sources.delete.submit")}
        destructive
        onConfirm={onConfirm}
      />
    </>
  );
}
