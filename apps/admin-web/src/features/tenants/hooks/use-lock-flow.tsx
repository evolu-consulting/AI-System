// ADM-FR-61 · luồng khoá/mở khoá tenant dùng chung cho danh sách và chi tiết: hộp thoại xác nhận + gọi API + toast.
import type { Tenant } from "@ai/contracts";
import { type ReactNode, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { describeError } from "@/lib/errors";
import { useTr } from "@/lib/use-translate";
import { useSetTenantLocked } from "../api";

type Target = { id: string; key: string; userCount: number; locked: boolean };

export function useLockFlow(): {
  requestLock: (t: Pick<Tenant, "id" | "key" | "user_count">) => void;
  requestUnlock: (t: Pick<Tenant, "id" | "key" | "user_count">) => void;
  dialogs: ReactNode;
} {
  const { t } = useTranslation();
  const tr = useTr();
  const mutation = useSetTenantLocked();
  const [target, setTarget] = useState<Target | null>(null);
  const [open, setOpen] = useState(false);

  const request = useCallback(
    (locked: boolean) => (tn: Pick<Tenant, "id" | "key" | "user_count">) => {
      setTarget({ id: tn.id, key: tn.key, userCount: tn.user_count, locked });
      setOpen(true);
    },
    [],
  );

  const confirm = async () => {
    if (!target) return;
    try {
      await mutation.mutateAsync({ id: target.id, locked: target.locked });
      notifySuccess(
        t(target.locked ? "tenants.toast.locked" : "tenants.toast.unlocked", { key: target.key }),
      );
    } catch (err) {
      const spec = describeError(err);
      notifyError(tr(spec.key, spec.params));
      throw err;
    }
  };

  const locking = target?.locked ?? true;
  const key = target?.key ?? "";
  const dialogs = (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      level={locking ? "heavy" : "medium"}
      destructive={locking}
      title={t(locking ? "tenants.lock.title" : "tenants.unlock.title", { key })}
      description={
        locking
          ? t("tenants.lock.body", { key, users: target?.userCount ?? 0 })
          : t("tenants.unlock.body")
      }
      confirmLabel={t(locking ? "tenants.lock.button" : "tenants.unlock.submit")}
      confirmText={key}
      typePrompt={t("tenants.lock.typeConfirm", { key })}
      onConfirm={confirm}
    />
  );
  return { requestLock: request(true), requestUnlock: request(false), dialogs };
}
