// ADM-FR-60 · /tenants/new: tạo tenant + tenant_admin đầu tiên (một transaction), hiện mật khẩu tạm một lần.
import type { TenantCreateResponse } from "@ai/contracts";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { ForbiddenState } from "@/components/shared/states/ForbiddenState";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { UnsavedGuard } from "@/components/shared/UnsavedGuard";
import { useSession } from "@/lib/auth/use-session";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { useCreateTenant } from "../api";
import { TenantCreatedDialog } from "../components/TenantCreatedDialog";
import { type CreateFieldErrors, TenantCreateForm } from "../components/TenantCreateForm";
import { slotsToValue, type TenantCreateValues } from "../lib/schemas";

const FIELD_BY_CODE: Record<string, keyof CreateFieldErrors> = {
  KEY_TAKEN: "key",
  USERNAME_TAKEN: "username",
  EMAIL_TAKEN: "email",
};

export function TenantCreatePage() {
  const { t } = useTranslation();
  const tr = useTr();
  const router = useRouter();
  const role = useSession((s) => s.me?.role);
  const create = useCreateTenant();
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<CreateFieldErrors>({});
  const [created, setCreated] = useState<TenantCreateResponse | null>(null);

  if (role !== "platform_admin") return <ForbiddenState />;

  const fail = (err: unknown) => {
    const spec = describeError(err);
    const text = tr(spec.key, spec.params);
    const field = err instanceof ApiError ? FIELD_BY_CODE[err.code] : undefined;
    if (field) setErrors({ [field]: text });
    else if (!(err instanceof ApiError && err.code === "UNAUTHORIZED")) notifyError(text);
  };

  const submit = async (v: TenantCreateValues) => {
    setErrors({});
    try {
      const res = await create.mutateAsync({
        key: v.key,
        name: v.name,
        max_concurrent_sub: slotsToValue(v.slots),
        first_admin: {
          username: v.username,
          display_name: v.display_name,
          email: v.email,
          locale: v.locale,
        },
      });
      setDirty(false);
      setCreated(res);
    } catch (err) {
      fail(err);
    }
  };

  const goToTenant = async () => {
    if (!created) return;
    notifySuccess(t("tenants.toast.created", { key: created.tenant.key }));
    await router.navigate({ to: "/tenants/$tenantId", params: { tenantId: created.tenant.id } });
  };

  return (
    <>
      <PageHeader title={t("tenants.new.title")} />
      <TenantCreateForm
        pending={create.isPending}
        serverErrors={errors}
        onDirtyChange={setDirty}
        onCancel={() => void router.navigate({ to: "/tenants" })}
        onSubmit={submit}
      />
      <UnsavedGuard dirty={dirty} />
      {created ? (
        <TenantCreatedDialog
          tenantKey={created.tenant.key}
          username={created.first_admin.username}
          password={created.temp_password}
          onContinue={goToTenant}
        />
      ) : null}
    </>
  );
}
