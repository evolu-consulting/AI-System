// ADM-FR-04 · trạng thái rỗng của Users: không có user / không khớp bộ lọc (kèm "Xoá bộ lọc").
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { Button } from "@/components/ui/button";

type Props = {
  filtered: boolean;
  q?: string;
  createAction?: ReactNode;
  onClear: () => void;
};

export function UsersEmpty({ filtered, q, createAction, onClear }: Props) {
  const { t } = useTranslation();
  if (!filtered) return <EmptyState message={t("users.empty")} action={createAction} />;
  return (
    <EmptyState
      message={q ? t("state.empty.noResults", { q }) : t("state.empty.noMatch")}
      action={
        <Button variant="outline" onClick={onClear}>
          {t("common.clearFilters")}
        </Button>
      }
    />
  );
}
