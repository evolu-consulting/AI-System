// ADM-FR-14, ADM-FR-20, ADM-FR-30 · M2 · thanh lưu dính đáy của editor (Workflow, Command, Feature): "Chưa lưu thay đổi" · Huỷ · Lưu.
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

type Props = {
  dirty: boolean;
  pending: boolean;
  /** Danh sách để quay về khi Huỷ. */
  cancelTo: "/workflows" | "/commands" | "/features";
  /** Nội dung thêm (vd cảnh báo) bên trái nút. */
  children?: ReactNode;
  /** `form` id nếu nút Lưu nằm ngoài `<form>`. */
  formId?: string;
  disabled?: boolean;
};

export function EditorSaveBar({ dirty, pending, cancelTo, children, formId, disabled }: Props) {
  const { t } = useTranslation();
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-6 flex flex-wrap items-center gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
      <div className="min-w-0 flex-1 text-label text-muted-foreground">
        {dirty ? t("common.unsaved") : null}
        {children}
      </div>
      <Button variant="outline" asChild>
        <Link to={cancelTo}>{t("common.cancel")}</Link>
      </Button>
      <Button type="submit" form={formId} disabled={pending || disabled} aria-disabled={pending}>
        {t("common.save")}
      </Button>
    </div>
  );
}
