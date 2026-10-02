// ADM-FR-04, ADM-FR-05 · hành động trên user từ menu `⋯`: khoá / reset / đăng xuất mọi thiết bị (có xác nhận), mở khoá (ngay).
import type { TempPasswordResponse, User } from "@ai/contracts";
import { type ReactNode, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { useUserAction } from "../api";
import { ResetPasswordDialog, type ResetResult } from "../components/dialogs/ResetPasswordDialog";
import { type PendingAction, UserActionDialog } from "../components/dialogs/UserActionDialog";
import type { UserActionKind } from "../lib/status";

const API_ACTION = {
  lock: "lock",
  unlock: "unlock",
  reset: "reset-password",
  logoutAll: "logout-all",
} as const;

const TOAST = { lock: "locked", unlock: "unlocked", logoutAll: "loggedOut" } as const;

/** Gọi API cho một hành động; thành công → toast (hoặc trả mật khẩu tạm cho reset), lỗi → toast bền (401 để modal phiên hết hạn lo). */
function useRunUserAction(onReset: (r: ResetResult) => void) {
  const { t } = useTranslation();
  const tr = useTr();
  const { mutateAsync } = useUserAction();
  return useCallback(
    async (kind: UserActionKind, user: User) => {
      try {
        const res = await mutateAsync({ id: user.id, action: API_ACTION[kind] });
        if (kind === "reset") {
          const { temp_password } = res as TempPasswordResponse;
          onReset({ tenantKey: user.tenant_key, username: user.username, password: temp_password });
          return;
        }
        notifySuccess(t(`users.toast.${TOAST[kind]}`, { username: user.username }));
      } catch (err) {
        if (err instanceof ApiError && err.code === "UNAUTHORIZED") return;
        const spec = describeError(err);
        notifyError(tr(spec.key, spec.params));
      }
    },
    [mutateAsync, onReset, t, tr],
  );
}

export function useUserActions(): {
  onAction: (kind: UserActionKind, user: User) => void;
  dialogs: ReactNode;
} {
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [open, setOpen] = useState(false);
  const [reset, setReset] = useState<ResetResult | null>(null);
  const run = useRunUserAction(setReset);

  const onAction = useCallback(
    (kind: UserActionKind, user: User) => {
      if (kind === "unlock") {
        void run(kind, user);
        return;
      }
      setPending({ kind, user });
      setOpen(true);
    },
    [run],
  );

  const dialogs = (
    <>
      <UserActionDialog
        open={open}
        onOpenChange={setOpen}
        pending={pending}
        onConfirm={() => (pending ? run(pending.kind, pending.user) : undefined)}
      />
      {reset ? <ResetPasswordDialog result={reset} onClose={() => setReset(null)} /> : null}
    </>
  );
  return { onAction, dialogs };
}
