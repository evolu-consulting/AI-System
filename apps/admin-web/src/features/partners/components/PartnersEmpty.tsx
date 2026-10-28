// ADM-FR-74 · trạng thái rỗng của Đối tác: chưa chọn tenant (platform) / chưa có công ty / không khớp bộ lọc.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { Button } from "@/components/ui/button";

type Props = {
  needsTenant: boolean;
  filtered: boolean;
  q?: string;
  createAction?: ReactNode;
  onClear: () => void;
};

export function PartnersEmpty({ needsTenant, filtered, q, createAction, onClear }: Props) {
  const { t } = useTranslation();
  if (needsTenant) return <EmptyState message={t("partners.selectTenant")} />;
  if (!filtered) return <EmptyState message={t("partners.empty.text")} action={createAction} />;
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
