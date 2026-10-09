// ADM-BR-10 · M2-R19 · ô "Thêm feature": chip feature đã chọn (`Bỏ feature {key}`) + RefPicker; mặc định `core`.
// CR-055: không chọn feature nào vẫn lưu được — chỉ hiện gợi ý "chưa gắn feature" (không chặn).
import { X } from "lucide-react";
import { useFormContext, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { FormField } from "@/components/shared/form/FormField";
import { RefPicker } from "@/components/shared/RefPicker";
import { pickLocalized } from "@/lib/localized";
import { useTr } from "@/lib/use-translate";
import { useFeatureOptions } from "../../hooks/use-command-queries";
import type { CommandFormValues } from "../../lib/schemas";

export function FeatureField() {
  const { t, i18n } = useTranslation();
  const tr = useTr();
  const { control, setValue, trigger, formState } = useFormContext<CommandFormValues>();
  const ids = useWatch({ control, name: "feature_ids" });
  const options = useFeatureOptions();
  const byId = new Map((options.data ?? []).map((f) => [f.id, f]));
  const raw = formState.errors.feature_ids;
  const message = raw?.message ?? raw?.root?.message;

  const change = (next: string[]) => {
    setValue("feature_ids", next, { shouldDirty: true });
    void trigger("feature_ids");
  };

  return (
    <FormField
      id="cmd-features"
      label={t("commands.field.features")}
      description={ids.length === 0 ? t("commands.feature.noneHint") : undefined}
      error={message ? tr(message) : undefined}
    >
      {() => (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {ids.map((id) => {
              const f = byId.get(id);
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-label"
                >
                  {f ? pickLocalized(f.name, i18n.language) : id}
                  <button
                    type="button"
                    aria-label={t("commands.feature.remove.aria", { name: f?.key ?? id })}
                    onClick={() => change(ids.filter((x) => x !== id))}
                    className="rounded-full p-0.5 hover:bg-background focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    <X aria-hidden className="size-3.5" />
                  </button>
                </span>
              );
            })}
          </div>
          <RefPicker
            label={t("commands.field.featuresAdd")}
            options={(options.data ?? []).map((f) => ({
              id: f.id,
              label: pickLocalized(f.name, i18n.language),
              hint: f.key,
            }))}
            selectedIds={ids}
            isLoading={options.isPending}
            onPick={(id) => change([...ids, id])}
          />
        </div>
      )}
    </FormField>
  );
}
