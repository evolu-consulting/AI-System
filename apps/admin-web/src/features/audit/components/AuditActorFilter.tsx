// ADM-FR-51 · lọc "Người thực hiện": combobox gõ-để-tìm trên GET /admin/users?q; chọn xong hiện chip (bỏ chọn bằng nút xoá).
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SearchCombobox } from "@/components/shared/SearchCombobox";
import { Button } from "@/components/ui/button";
import { useActorSearch } from "../hooks/use-actor-search";

type Props = { value: string | undefined; onChange: (id: string | undefined) => void };

export function AuditActorFilter({ value, onChange }: Props) {
  const { t } = useTranslation();
  const s = useActorSearch(value);
  if (value) {
    const name = s.chosenName ?? "…";
    return (
      <Button
        type="button"
        variant="secondary"
        aria-label={t("audit.filter.actorClear", { name })}
        onClick={() => onChange(undefined)}
      >
        {t("audit.filter.actorChip", { name })}
        <X aria-hidden className="size-4" />
      </Button>
    );
  }
  return (
    <SearchCombobox
      label={t("audit.filter.actor")}
      placeholder={t("audit.filter.actor")}
      options={s.options}
      isLoading={s.isLoading}
      onQuery={s.setQ}
      onPick={onChange}
    />
  );
}
