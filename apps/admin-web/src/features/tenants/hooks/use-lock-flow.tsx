// ADM-FR-61 · luồng khoá/mở khoá tenant dùng chung cho danh sách và chi tiết: hộp thoại xác nhận + gọi API + toast.
import type { Tenant } from "@ai/contracts";
import { type ReactNode, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { describeError } from "@/lib/errors";
import { useTr } from "@/lib/use-translate";
import { useSetTenantLocked } from "../api";
import { type LockTarget, TenantLockDialog } from "../components/TenantLockDialog";

type TenantRef = Pick<Tenant, "id" | "key" | "user_count">;

export function useLockFlow(): {
  requestLock: (t: TenantRef) => void;
  requestUnlock: (t: TenantRef) => void;
  dialogs: ReactNode;
} {
  const { t } = useTranslation();
  const tr = useTr();
  const { mutateAsync } = useSetTenantLocked();
  const [target, setTarget] = useState<LockTarget | null>(null);
  const [open, setOpen] = useState(false);

  const request = useCallback(
    (locked: boolean) => (tn: TenantRef) => {
      setTarget({ id: tn.id, key: tn.key, userCount: tn.user_count, locked });
      setOpen(true);
    },
    [],
  );

  const confirm = async () => {
    if (!target) return;
    try {
      await mutateAsync({ id: target.id, locked: target.locked });
      const key = target.locked ? "tenants.toast.locked" : "tenants.toast.unlocked";
      notifySuccess(t(key, { key: target.key }));
    } catch (err) {
      const spec = describeError(err);
      notifyError(tr(spec.key, spec.params));
      throw err;
    }
  };

  const dialogs = (
    <TenantLockDialog open={open} onOpenChange={setOpen} target={target} onConfirm={confirm} />
  );
  return { requestLock: request(true), requestUnlock: request(false), dialogs };
}
