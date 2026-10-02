// ADM-FR-04, ADM-FR-63 · nối drawer với API: nạp user khi sửa, tạo/lưu, ánh xạ lỗi server vào đúng ô.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LazyConflictDialog } from "@/components/shared/conflict/LazyConflictDialog";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { useCreateUser, useUser } from "../api";
import { type CreatedInfo, UserDrawer } from "../components/drawer/UserDrawer";
import type { UserFormErrors } from "../components/drawer/UserForm";
import { useUserConflict } from "../hooks/use-user-conflict";
import { emailToValue, type UserCreateValues } from "../lib/schemas";

type Props = {
  mode: "create" | "edit";
  userId?: string;
  tenantKey: string;
  tenantId?: string;
  selfId: string;
  onClose: () => void;
};

const FIELD_BY_CODE: Record<string, keyof UserFormErrors> = {
  USERNAME_TAKEN: "username",
  EMAIL_TAKEN: "email",
  EMAIL_REQUIRED: "email",
  LAST_ADMIN: "role",
};

export function UserDrawerController({
  mode,
  userId,
  tenantKey,
  tenantId,
  selfId,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  const userQuery = useUser(userId, mode === "edit");
  const create = useCreateUser(tenantId);
  const [errors, setErrors] = useState<UserFormErrors>({});
  const [created, setCreated] = useState<CreatedInfo | null>(null);

  const user = userQuery.data;
  // 404 (id lạ hoặc thuộc tenant khác, BR-09) và mọi lỗi tải khác đều hiện "Không tìm thấy" trong drawer.
  const notFound = userQuery.isError;

  const fail = (err: unknown) => {
    if (err instanceof ApiError && err.code === "UNAUTHORIZED") return; // modal phiên hết hạn xử lý
    const spec = describeError(err);
    const text = tr(spec.key, spec.params);
    const field = err instanceof ApiError ? FIELD_BY_CODE[err.code] : undefined;
    if (field) {
      setErrors({ [field]: text });
      return;
    }
    notifyError(text);
  };

  const conflict = useUserConflict(userId, {
    onSaved: () => {
      notifySuccess(t("users.toast.saved", { username: user?.username ?? "" }));
      onClose();
    },
    onFail: fail,
    onReload: () => void userQuery.refetch(),
  });

  const submit = async (v: UserCreateValues) => {
    setErrors({});
    try {
      if (mode === "create") {
        const res = await create.mutateAsync({
          username: v.username,
          display_name: v.display_name,
          email: emailToValue(v.email),
          role: v.role,
          locale: v.locale,
        });
        notifySuccess(t("users.toast.created", { username: res.user.username }));
        setCreated({ username: res.user.username, password: res.temp_password });
        return;
      }
      if (!user) return;
      await conflict.save(
        {
          display_name: v.display_name,
          email: emailToValue(v.email),
          locale: v.locale,
          ...(v.role === user.role ? {} : { role: v.role }),
        },
        user.version,
      );
    } catch (err) {
      fail(err);
    }
  };

  return (
    <>
      <UserDrawer
        mode={mode}
        tenantKey={user?.tenant_key ?? tenantKey}
        user={user}
        loading={mode === "edit" && userQuery.isPending}
        notFound={notFound}
        isSelf={!!user && user.id === selfId}
        pending={create.isPending || conflict.pending}
        serverErrors={errors}
        created={created}
        onSubmit={submit}
        onClose={onClose}
      />
      <LazyConflictDialog props={conflict.props} />
    </>
  );
}
