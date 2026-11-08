// CR-121 · tab Hồ sơ của công ty: "Thông tin công ty" · "Liên hệ và lãnh đạo" · "Phòng ban" (chỉ đọc). Sửa tại chỗ từng ô;
// platform_admin sửa, tenant_admin chỉ xem. Tên công ty sửa qua PATCH /admin/tenants/:id (một nơi duy nhất).
import type { TenantDetail } from "@ai/contracts/tenants";
import { notifySuccess } from "@ai/web-kit/ui/toast";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { LoadingState } from "@/components/shared/states/LoadingState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError } from "@/lib/api-error";
import { describeError } from "@/lib/errors";
import { useTr } from "@/lib/use-translate";
import {
  useTenantCompanyProfile,
  useTenantMembers,
  useUpdateTenantProfile,
} from "../../hooks/use-tenant-api";
import { type ProfileTextField, validateField } from "../../lib/profile-fields";
import { TenantProfileCard } from "../TenantProfileCard";
import { DirectoryCard } from "./DirectoryCard";
import { InlineField } from "./InlineField";
import { PersonField } from "./PersonField";

/** Lỗi server ⇒ câu đã dịch (mã 422 `LEADER_NOT_MEMBER` có khoá riêng trong `describeError`). */
function useSaveError() {
  const tr = useTr();
  return (err: unknown): Error => {
    const spec = describeError(err);
    return new Error(tr(spec.key, spec.params));
  };
}

type Props = {
  tenant: TenantDetail;
  canEdit: boolean;
  /** Lưu tên công ty qua `PATCH /admin/tenants/:id` của trang (cùng ConflictDialog + toast "Đã lưu {mã}"). */
  onSaveName: (name: string) => Promise<unknown>;
};

export function TenantProfileTab({ tenant, canEdit, onSaveName }: Props) {
  const { t, i18n } = useTranslation();
  const toError = useSaveError();
  const profile = useTenantCompanyProfile(tenant.id, true);
  const members = useTenantMembers(tenant.id, canEdit);
  const patchProfile = useUpdateTenantProfile(tenant.id);

  if (profile.isPending) return <LoadingState />;
  if (profile.error || !profile.data) {
    const err = profile.error instanceof ApiError ? profile.error : null;
    return (
      <ErrorState
        message={err?.message ?? ""}
        code={err?.code ?? "NETWORK_ERROR"}
        onRetry={() => void profile.refetch()}
      />
    );
  }
  const p = profile.data;

  const saved = () => notifySuccess(t("tenants.company.saved"));
  const saveProfile = async (body: Record<string, string | number | null>) => {
    try {
      await patchProfile.mutateAsync({ version: p.version, ...body });
      saved();
    } catch (e) {
      void profile.refetch(); // 409: nạp lại bản mới để lần sửa sau đúng phiên bản
      throw toError(e);
    }
  };
  const text = (
    field: ProfileTextField,
    label: string,
    value: string | null,
    o: { inputMode?: "text" | "numeric" | "email" | "tel"; display?: string } = {},
  ) => (
    <InlineField
      id={`tp-${field}`}
      label={label}
      value={value}
      display={o.display}
      inputMode={o.inputMode}
      readOnly={!canEdit}
      validate={(raw) => {
        const r = validateField(field, raw);
        return r.ok ? undefined : r.error;
      }}
      onSave={(raw) => {
        const r = validateField(field, raw);
        if (!r.ok) return Promise.reject(new Error(t(r.error)));
        return field === "name"
          ? onSaveName(String(r.value)).then(() => undefined)
          : saveProfile({ [field]: r.value });
      }}
    />
  );

  return (
    <div className="grid max-w-3xl gap-4" data-testid="tenant-profile-tab">
      <Card>
        <CardHeader>
          <CardTitle>{t("tenants.company.card.info")}</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          {text("name", t("tenants.field.name"), tenant.name)}
          {text("legal_name", t("tenants.company.legalName"), p.legal_name)}
          {text("tax_code", t("tenants.company.taxCode"), p.tax_code)}
          {text("address", t("tenants.company.address"), p.address)}
          {text(
            "staff_size",
            t("tenants.company.staffSize"),
            p.staff_size === null ? null : String(p.staff_size),
            {
              inputMode: "numeric",
              display:
                p.staff_size === null
                  ? undefined
                  : t("tenants.company.staffCount", { count: p.staff_size }),
            },
          )}
          <p className="py-2 text-caption text-muted-foreground">
            {t("tenants.company.memberCount", { count: p.member_count })}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("tenants.company.card.contact")}</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          {text("contact_name", t("tenants.company.contactName"), p.contact_name)}
          {text("contact_email", t("tenants.company.contactEmail"), p.contact_email, {
            inputMode: "email",
          })}
          {text("contact_phone", t("tenants.company.contactPhone"), p.contact_phone, {
            inputMode: "tel",
          })}
          <PersonField
            id="tp-ceo"
            label={t("tenants.company.ceo")}
            person={p.ceo}
            members={members.data?.items}
            readOnly={!canEdit}
            onSave={(id) => saveProfile({ ceo_user_id: id })}
          />
          <PersonField
            id="tp-director"
            label={t("tenants.company.director")}
            person={p.director}
            members={members.data?.items}
            readOnly={!canEdit}
            onSave={(id) => saveProfile({ director_user_id: id })}
          />
        </CardContent>
      </Card>

      <Card data-testid="tenant-departments">
        <CardHeader>
          <CardTitle>{t("tenants.company.card.departments")}</CardTitle>
        </CardHeader>
        <CardContent>
          {p.departments.length === 0 ? (
            <p className="text-body text-muted-foreground">
              {t("tenants.company.departmentsEmpty")}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {p.departments.map((d) => (
                <li
                  key={d.group_id}
                  className="flex flex-wrap items-baseline justify-between gap-2 py-2"
                >
                  <span className="text-body font-medium">
                    {d.name[i18n.language] ?? d.name.vi ?? Object.values(d.name)[0]}
                  </span>
                  <span className="text-caption text-muted-foreground">
                    {t("tenants.company.deptPeople", { count: d.member_count })}
                    {d.head
                      ? ` · ${t("tenants.company.deptHead", { name: d.head.display_name })}`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link
            to="/tenants/$tenantId"
            params={{ tenantId: tenant.id }}
            search={{ tab: "members", view: "groups" }}
            className="mt-3 inline-block text-label text-primary hover:underline"
          >
            {t("tenants.company.manageGroups")}
          </Link>
        </CardContent>
      </Card>
      <DirectoryCard tenantId={tenant.id} profile={p} isPlatform={canEdit} />
      <TenantProfileCard profile={tenant.profile} />
    </div>
  );
}
