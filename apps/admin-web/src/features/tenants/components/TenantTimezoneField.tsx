// ADM-FR-72 · P-d1 T11c · ô "Múi giờ" của tenant (plan-frontend §3, FD5): ô chỉ-đọc + RefPicker nút "Đổi múi giờ".
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { FormField } from "@/components/shared/form/FormField";
import { RefPicker } from "@/components/shared/RefPicker";
import { Input } from "@/components/ui/input";
import { timeZoneOptions, utcOffsetLabel } from "@/features/processes/domain/tz-format";

type Props = {
  id: string;
  value: string;
  error?: string | undefined;
  onChange: (zone: string) => void;
};

function browserZones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
}

export function TenantTimezoneField({ id, value, error, onChange }: Props) {
  const { t } = useTranslation();
  const now = useMemo(() => new Date().toISOString(), []);
  const options = useMemo(() => timeZoneOptions(browserZones(), now), [now]);
  const offset = utcOffsetLabel(value, now);
  const shown = offset ? t("tenants.timezone.value", { tz: value, offset }) : value;
  return (
    <FormField
      id={id}
      label={t("tenants.field.timezone")}
      description={t("tenants.field.timezoneHint")}
      error={error}
    >
      {(p) => (
        <div className="flex gap-2">
          <Input {...p} value={shown} readOnly className="bg-muted font-mono" />
          <RefPicker
            trigger="button"
            label={t("tenants.timezone.change")}
            placeholder={t("tenants.timezone.search")}
            options={options}
            selectedIds={[value]}
            onPick={onChange}
          />
        </div>
      )}
    </FormField>
  );
}
