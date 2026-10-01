// ADM-FR-04 · hàng bộ lọc Users: Tenant (platform), chip trạng thái có số, Role, chip "Chưa đăng nhập", ô tìm. Mọi giá trị nằm trên URL.
import type { ListCounts } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { FilterChips } from "@/components/shared/FilterChips";
import { SearchBox } from "@/components/shared/SearchBox";
import { type TenantOption, TenantPicker } from "@/components/shared/TenantPicker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type StatusFilter = "all" | "active" | "locked";
export type RoleFilter = "all" | "platform_admin" | "tenant_admin" | "member";

type Props = {
  /** Có giá trị → hiện ô chọn Tenant (chỉ platform_admin). */
  tenants?: TenantOption[];
  tenantKey: string | null;
  status: StatusFilter;
  role: RoleFilter;
  never: boolean;
  q: string;
  counts?: ListCounts;
  /** `platform_admin` chỉ là lựa chọn khi đang xem tenant platform. */
  showPlatformRole: boolean;
  onTenant: (key: string | null) => void;
  onStatus: (s: StatusFilter) => void;
  onRole: (r: RoleFilter) => void;
  onNever: (never: boolean) => void;
  onQuery: (q: string) => void;
};

export function UserFilters(p: Props) {
  const { t } = useTranslation();
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      {p.tenants ? (
        <TenantPicker tenants={p.tenants} value={p.tenantKey} onChange={p.onTenant} />
      ) : null}
      <FilterChips<StatusFilter>
        label={t("users.col.status")}
        value={p.status}
        onChange={p.onStatus}
        chips={[
          { value: "all", label: t("common.all"), count: p.counts?.all },
          { value: "active", label: t("users.status.active"), count: p.counts?.active },
          { value: "locked", label: t("users.status.locked"), count: p.counts?.locked },
        ]}
      />
      <Select value={p.role} onValueChange={(v) => p.onRole(v as RoleFilter)}>
        <SelectTrigger aria-label={t("users.filter.role.label")} className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("users.filter.role.all")}</SelectItem>
          <SelectItem value="tenant_admin">tenant_admin</SelectItem>
          <SelectItem value="member">member</SelectItem>
          {p.showPlatformRole ? (
            <SelectItem value="platform_admin">platform_admin</SelectItem>
          ) : null}
        </SelectContent>
      </Select>
      <FilterChips<"never" | "any">
        label={t("users.filter.neverLoggedIn")}
        value={p.never ? "never" : "any"}
        onChange={(v) => p.onNever(v === "never" && !p.never)}
        chips={[{ value: "never", label: t("users.filter.neverLoggedIn") }]}
      />
      <div className="ml-auto w-full sm:w-auto">
        <SearchBox label={t("users.list.search")} value={p.q} onChange={p.onQuery} />
      </div>
    </div>
  );
}
