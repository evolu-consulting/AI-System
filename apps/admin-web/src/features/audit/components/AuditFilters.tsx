// ADM-FR-51 · M4-R12 · thanh lọc Nhật ký: Tenant (platform) · Loại · Hành động · Người thực hiện · Thời gian · tìm theo tên.
import { AUDIT_ACTIONS, type AuditAction, type AuditEntity } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { PeriodFilter } from "@/components/shared/form/PeriodFilter";
import type { Period } from "@/components/shared/form/period";
import { SearchBox } from "@/components/shared/form/SearchBox";
import type { TenantOption } from "@/components/shared/TenantPicker";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { entityKey } from "@/lib/audit-sentence";
import { type AuditSearch, FILTER_ENTITIES } from "../lib/search";
import { AuditActorFilter } from "./AuditActorFilter";

const ALL = "all";
const SYSTEM = "system";

type Props = {
  search: AuditSearch;
  period: Period;
  platform: boolean;
  tenants: TenantOption[];
  filtered: boolean;
  onChange: (patch: Partial<AuditSearch>) => void;
  onPeriod: (p: Period) => void;
  onClear: () => void;
};

function Pick(p: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <Select value={p.value} onValueChange={p.onChange}>
      <SelectTrigger aria-label={p.label} className="w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>{p.children}</SelectContent>
    </Select>
  );
}

export function AuditFilters(p: Props) {
  const { t } = useTranslation();
  const none = (v: string) => (v === ALL ? undefined : v);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {p.platform ? (
        <Pick
          label={t("common.tenantPicker.label")}
          value={p.search.tenant ?? ALL}
          onChange={(v) => p.onChange({ tenant: none(v) })}
        >
          <SelectItem value={ALL}>{t("common.tenantPicker.all")}</SelectItem>
          <SelectItem value={SYSTEM}>{t("audit.scope.system")}</SelectItem>
          {p.tenants.map((tn) => (
            <SelectItem key={tn.id} value={tn.key} className="font-mono">
              {tn.key}
            </SelectItem>
          ))}
        </Pick>
      ) : null}
      <Pick
        label={t("audit.filter.entity")}
        value={p.search.entity ?? ALL}
        onChange={(v) => p.onChange({ entity: none(v) as AuditEntity | undefined })}
      >
        <SelectItem value={ALL}>{t("common.all")}</SelectItem>
        {FILTER_ENTITIES.map((e) => (
          <SelectItem key={e} value={e}>
            {t(`audit.entityLabel.${entityKey(e)}`)}
          </SelectItem>
        ))}
      </Pick>
      <Pick
        label={t("audit.filter.action")}
        value={p.search.action ?? ALL}
        onChange={(v) => p.onChange({ action: none(v) as AuditAction | undefined })}
      >
        <SelectItem value={ALL}>{t("common.all")}</SelectItem>
        {AUDIT_ACTIONS.map((a) => (
          <SelectItem key={a} value={a}>
            {t(`audit.action.${a}`)}
          </SelectItem>
        ))}
      </Pick>
      <AuditActorFilter value={p.search.actor} onChange={(actor) => p.onChange({ actor })} />
      <PeriodFilter value={p.period} onChange={p.onPeriod} />
      <SearchBox
        label={t("audit.filter.search")}
        value={p.search.q ?? ""}
        onChange={(q) => p.onChange({ q: q.trim() || undefined })}
      />
      {p.filtered ? (
        <Button type="button" variant="ghost" onClick={p.onClear}>
          {t("common.clearFilters")}
        </Button>
      ) : null}
    </div>
  );
}
