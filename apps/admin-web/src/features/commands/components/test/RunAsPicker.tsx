// ADM-FR-23 · X1 F4 · "Chạy với tư cách user…": gõ để tìm user mọi tenant (platform_admin), chọn 1; vắng = chính admin.
import { useTranslation } from "react-i18next";
import { SearchCombobox } from "@/components/shared/SearchCombobox";
import { Button } from "@/components/ui/button";
import { useRunAsOptions } from "../../hooks/use-run-as-options";

export type RunAs = { id: string; label: string } | null;
type Props = { value: RunAs; onChange: (v: RunAs) => void; error?: string };

export function RunAsPicker({ value, onChange, error }: Props) {
  const { t } = useTranslation();
  const picker = useRunAsOptions();
  return (
    <div className="space-y-1.5">
      <p aria-hidden className="font-medium text-label">
        {t("commands.test.runAs")}
      </p>
      <SearchCombobox
        label={t("commands.test.runAs")}
        placeholder={t("commands.test.runAsPlaceholder")}
        options={picker.options}
        isLoading={picker.isLoading}
        onQuery={picker.setQuery}
        onPick={(id) => {
          const o = picker.options.find((x) => x.id === id);
          onChange({ id, label: o ? `${o.label} (${o.hint})` : id });
        }}
      />
      {value ? (
        <p className="flex items-center gap-2 text-caption">
          <span>{t("commands.test.runAsPicked", { name: value.label })}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t("commands.test.runAsClear", { name: value.label })}
            onClick={() => onChange(null)}
          >
            ×
          </Button>
        </p>
      ) : (
        <p className="text-caption text-muted-foreground">{t("commands.test.runAsSelf")}</p>
      )}
      {error ? <p className="text-caption text-destructive">{error}</p> : null}
    </div>
  );
}
