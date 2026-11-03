// CR-112 · ADM-FR-79 · bước 1 của wizard: tạo công ty + tenant_admin đầu tiên NGAY (POST /admin/tenants có sẵn, không giao dịch xuyên bước).
// Mã trùng ⇒ lỗi tại ô mã. Xong hiện mật khẩu tạm một lần rồi sang bước 2 (công ty đã tồn tại dù người dùng bỏ ngang).
import type { TenantCreateResponse } from "@ai/contracts";
import { useState } from "react";
import { notifyError } from "@/components/shared/toast";
import { UnsavedGuard } from "@/components/shared/UnsavedGuard";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { useCreateTenant } from "../../api";
import { slotsToValue, type TenantCreateValues } from "../../lib/schemas";
import { TenantCreatedDialog } from "../TenantCreatedDialog";
import { type CreateFieldErrors, TenantCreateForm } from "../TenantCreateForm";

const FIELD_BY_CODE: Record<string, keyof CreateFieldErrors> = {
  KEY_TAKEN: "key",
  USERNAME_TAKEN: "username",
  EMAIL_TAKEN: "email",
};

type Props = { onCancel: () => void; onCreated: (res: TenantCreateResponse) => void };

export function WizardCompanyStep({ onCancel, onCreated }: Props) {
  const tr = useTr();
  const create = useCreateTenant();
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<CreateFieldErrors>({});
  const [created, setCreated] = useState<TenantCreateResponse | null>(null);

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
        timezone: v.timezone,
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

  return (
    <>
      <TenantCreateForm
        pending={create.isPending}
        serverErrors={errors}
        onDirtyChange={setDirty}
        onCancel={onCancel}
        onSubmit={submit}
      />
      <UnsavedGuard dirty={dirty} />
      {created ? (
        <TenantCreatedDialog
          tenantKey={created.tenant.key}
          username={created.first_admin.username}
          password={created.temp_password}
          onContinue={() => onCreated(created)}
        />
      ) : null}
    </>
  );
}
