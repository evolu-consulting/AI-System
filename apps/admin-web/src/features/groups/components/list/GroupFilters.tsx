// ADM-FR-62 · hàng lọc Groups: Tenant (platform), ô tìm. Mọi giá trị nằm trên URL.
import { useTranslation } from "react-i18next";
import { SearchBox } from "@/components/shared/form/SearchBox";
import { type TenantOption, TenantPicker } from "@/components/shared/TenantPicker";

type Props = {
  /** Có giá trị → hiện ô chọn Tenant (chỉ platform_admin). */
  tenants?: TenantOption[];
  tenantKey: string | null;
  q: string;
  onTenant: (key: string | null) => void;
  onQuery: (q: string) => void;
};

export function GroupFilters({ tenants, tenantKey, q, onTenant, onQuery }: Props) {
  const { t } = useTranslation();
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      {tenants ? <TenantPicker tenants={tenants} value={tenantKey} onChange={onTenant} /> : null}
      <div className="ml-auto w-full sm:w-auto">
        <SearchBox label={t("groups.list.search")} value={q} onChange={onQuery} />
      </div>
    </div>
  );
}
