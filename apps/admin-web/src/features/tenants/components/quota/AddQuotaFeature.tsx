// ADM-FR-40 · `+ Thêm quota theo feature` → Popover có combobox "Chọn feature" (feature đã entitlement + core, trừ feature đã có hàng).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RefPicker } from "@/components/shared/RefPicker";
import { Button } from "@/components/ui/button";
import { pickLocalized } from "@/lib/localized";
import type { QuotaFeatureOption } from "../../lib/quota-draft";

type Props = {
  options: QuotaFeatureOption[] | undefined;
  loading: boolean;
  taken: readonly string[];
  onPick: (option: QuotaFeatureOption) => void;
};

export function AddQuotaFeature({ options, loading, taken, onPick }: Props) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const left = (options ?? []).filter((o) => !taken.includes(o.id));
  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        {t("tenants.quota.addFeature")}
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <RefPicker
        label={t("tenants.quota.pickFeature")}
        options={left.map((o) => ({
          id: o.id,
          label: pickLocalized(o.name, i18n.language),
          hint: o.key,
        }))}
        isLoading={loading}
        onPick={(id) => {
          const o = left.find((x) => x.id === id);
          if (o) onPick(o);
          setOpen(false);
        }}
      />
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
        {t("common.cancel")}
      </Button>
      {!loading && left.length === 0 ? (
        <span className="text-caption text-muted-foreground">
          {t("tenants.quota.noFeatureLeft")}
        </span>
      ) : null}
    </div>
  );
}
