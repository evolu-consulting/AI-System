// ADM-FR-50 · M2-R05 · xoá secret: đang dùng → dialog chặn + DependencyList; không dùng → ConfirmDialog nặng (gõ lại tên).
// 409 `SECRET_IN_USE` (race) chuyển sang dialog chặn với `details.used_by`. Không hiển thị giá trị ở đâu (D10).
import type { Secret } from "@ai/contracts";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { useDeleteSecret } from "../api";
import { type DeleteTarget, SecretDeleteDialogs } from "../components/SecretDeleteDialogs";

/** `used_by` của 409 `SECRET_IN_USE` (workflow vừa tham chiếu secret giữa chừng). */
function usedByFrom(details: unknown): string[] {
  const list = (details as { used_by?: unknown } | null | undefined)?.used_by;
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
}

function useFail() {
  const tr = useTr();
  return (err: unknown) => {
    if (err instanceof ApiError && err.code === "UNAUTHORIZED") return;
    const spec = describeError(err);
    notifyError(tr(spec.key, spec.params));
  };
}

export function useSecretDelete() {
  const { t } = useTranslation();
  const fail = useFail();
  const del = useDeleteSecret();
  const [target, setTarget] = useState<DeleteTarget | null>(null);

  const request = useCallback((s: Secret) => {
    setTarget({ name: s.name, usedBy: s.used_by, blocked: s.used_by.length > 0 });
  }, []);
  const confirm = async () => {
    if (!target) return;
    try {
      await del.mutateAsync(target.name);
      notifySuccess(t("secrets.toast.deleted", { name: target.name }));
    } catch (err) {
      if (!(err instanceof ApiError && err.code === "SECRET_IN_USE")) {
        fail(err);
        throw err; // giữ hộp thoại mở
      }
      setTarget({ name: target.name, usedBy: usedByFrom(err.details), blocked: true });
    }
  };
  const dialogs = (
    <SecretDeleteDialogs target={target} onClose={() => setTarget(null)} onConfirm={confirm} />
  );
  return { request, dialogs };
}
