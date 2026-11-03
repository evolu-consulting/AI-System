// CR-112 · ADM-FR-76/77 · nhóm "CÔNG TY" của sidebar: platform_admin = mọi công ty + ô tìm + "Tạo công ty"; tenant_admin = chỉ công ty mình.
import { Link } from "@tanstack/react-router";
import { Building2, Lock, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { useTenantList } from "@/features/tenants/api";
import { useSession } from "@/lib/auth/use-session";
import { cn } from "@/lib/utils";
import { canCreateCompany, canSearchCompanies, companyEntries } from "../lib/companies";

type Props = { collapsed?: boolean; onNavigate?: () => void };

const ROW =
  "flex h-8 items-center gap-2 rounded-md px-3 text-label text-sidebar-foreground transition-colors hover:bg-sidebar-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";
const ACTIVE = { className: "bg-sidebar-accent font-medium text-sidebar-accent-foreground" };

function Note({ children }: { children: string }) {
  return <p className="px-3 py-1 text-caption text-muted-foreground">{children}</p>;
}

/** Thu gọn: một biểu tượng — platform về danh sách công ty, tenant_admin vào workspace công ty mình. */
function CollapsedCompanies({ onNavigate }: Pick<Props, "onNavigate">) {
  const { t } = useTranslation();
  const me = useSession((s) => s.me);
  const own = me?.tenant.id;
  return (
    <Link
      {...(canSearchCompanies(me?.role) || !own
        ? { to: "/tenants" as const }
        : { to: "/tenants/$tenantId" as const, params: { tenantId: own } })}
      onClick={onNavigate}
      aria-label={t("nav.group.companies")}
      title={t("nav.group.companies")}
      className={cn(ROW, "h-9 justify-center px-0 font-medium")}
      activeProps={ACTIVE}
    >
      <Building2 aria-hidden className="size-4 shrink-0" />
    </Link>
  );
}

function statusKey(list: { isPending: boolean; isError: boolean }, count: number, q: string) {
  if (list.isPending) return "nav.companies.loading" as const;
  if (list.isError) return "nav.companies.error" as const;
  if (count > 0) return null;
  return q ? ("nav.companies.noMatch" as const) : ("nav.companies.empty" as const);
}

export function SidebarCompanies({ collapsed = false, onNavigate }: Props) {
  const { t } = useTranslation();
  const me = useSession((s) => s.me);
  const role = me?.role;
  const [q, setQ] = useState("");
  const isPlatform = canSearchCompanies(role);
  const list = useTenantList({ q: "" }, isPlatform);
  const entries = companyEntries(role, me?.tenant, list.data?.items, q);

  if (collapsed) return <CollapsedCompanies onNavigate={onNavigate} />;

  const key = isPlatform ? statusKey(list, entries.length, q) : null;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-3 pb-1">
        {isPlatform ? (
          <Link
            to="/tenants"
            activeOptions={{ exact: true }}
            onClick={onNavigate}
            className="text-micro font-semibold tracking-wide text-subtle-foreground hover:text-foreground"
          >
            {t("nav.group.companies")}
          </Link>
        ) : (
          <p className="text-micro font-semibold tracking-wide text-subtle-foreground">
            {t("nav.group.companies")}
          </p>
        )}
        {canCreateCompany(role) ? (
          <Link
            to="/tenants/new"
            onClick={onNavigate}
            aria-label={t("nav.companies.create")}
            title={t("nav.companies.create")}
            className="grid size-6 place-items-center rounded-md text-sidebar-foreground hover:bg-sidebar-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <Plus aria-hidden className="size-4" />
          </Link>
        ) : null}
      </div>
      {isPlatform ? (
        <div className="px-1 pb-1">
          <Input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("nav.companies.search")}
            aria-label={t("nav.companies.search")}
            className="h-8"
          />
        </div>
      ) : null}
      {key ? <Note>{t(key)}</Note> : null}
      <ul aria-label={t("nav.companies.list")} className="max-h-60 space-y-0.5 overflow-y-auto">
        {entries.map((c) => (
          <li key={c.id}>
            <Link
              to="/tenants/$tenantId"
              params={{ tenantId: c.id }}
              onClick={onNavigate}
              title={c.key}
              className={ROW}
              activeProps={ACTIVE}
            >
              <Building2 aria-hidden className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              {c.locked ? (
                <Lock aria-label={t("nav.companies.locked")} className="size-3 shrink-0" />
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
