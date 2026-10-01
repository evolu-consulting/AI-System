// ADM-FR-04 · chọn tenant (chỉ platform_admin): mục đầu "Tất cả tenant"; giá trị mẫu "all" vì Radix Select không nhận "" (plan §14).
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const ALL_TENANTS = "all";

export type TenantOption = { id: string; key: string };

type Props = {
  tenants: TenantOption[];
  /** Mã công ty đang chọn, hoặc `null` = tất cả. */
  value: string | null;
  onChange: (key: string | null) => void;
};

export function TenantPicker({ tenants, value, onChange }: Props) {
  const { t } = useTranslation();
  return (
    <Select
      value={value ?? ALL_TENANTS}
      onValueChange={(v) => onChange(v === ALL_TENANTS ? null : v)}
    >
      <SelectTrigger aria-label={t("common.tenantPicker.label")} className="w-48">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_TENANTS}>{t("common.tenantPicker.all")}</SelectItem>
        {tenants.map((tn) => (
          <SelectItem key={tn.id} value={tn.key} className="font-mono">
            {tn.key}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
