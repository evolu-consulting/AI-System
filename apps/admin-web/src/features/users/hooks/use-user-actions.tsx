// ADM-FR-04, ADM-FR-05 · hành động trên user từ menu `⋯`: khoá / reset / đăng xuất mọi thiết bị (có xác nhận), mở khoá (ngay).
import type { TempPasswordResponse, User } from "@ai/contracts";
import { type ReactNode, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { useUserAction } from "../api";
import { ResetPasswordDialog, type ResetResult } from "../components/ResetPasswordDialog";
import type { UserActionKind } from "../lib/status";

type Pending = { kind: "lock" | "reset" | "logoutAll"; user: User };

const API_ACTION = {
  lock: "lock",
  unlock: "unlock",
  reset: "reset-password",
  logoutAll: "logout-all",
} as const;

const DIALOG = {
  lock: { title: "users.lock.title", body: "users.lock.body", submit: "users.lock.submit" },
  reset: { title: "users.reset.title", body: "users.reset.body", submit: "users.reset.submit" },
  logoutAll: {
    title: "users.logoutAll.title",
    body: "users.logoutAll.body",
    submit: "users.logoutAll.submit",
  },
} as const;

export function useUserActions(): {
  onAction: (kind: UserActionKind, user: User) => void;
  dialogs: ReactNode;
} {
  const { t } = useTranslation();
  const tr = useTr();
  const { mutateAsync } = useUserAction();
  const [pending, setPending] = useState<Pending | null>(null);
  const [open, setOpen] = useState(false);
  const [reset, setReset] = useState<ResetResult | null>(null);

  const run = useCallback(
    async (kind: UserActionKind, user: User) => {
      try {
        const res = await mutateAsync({ id: user.id, action: API_ACTION[kind] });
        if (kind === "reset") {
          const { temp_password } = res as TempPasswordResponse;
          setReset({
            tenantKey: user.tenant_key,
            username: user.username,
            password: temp_password,
          });
          return;
        }
        const toast = { lock: "locked", unlock: "unlocked", logoutAll: "loggedOut" } as const;
        notifySuccess(t(`users.toast.${toast[kind]}`, { username: user.username }));
      } catch (err) {
        // 401: để modal phiên hết hạn xử lý, không báo thêm toast lỗi.
        if (err instanceof ApiError && err.code === "UNAUTHORIZED") return;
        const spec = describeError(err);
        notifyError(tr(spec.key, spec.params));
      }
    },
    [mutateAsync, t, tr],
  );

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

  const cfg = DIALOG[pending?.kind ?? "lock"];
  const username = pending?.user.username ?? "";
  const dialogs = (
    <>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={tr(cfg.title, { username })}
        description={tr(cfg.body)}
        confirmLabel={tr(cfg.submit)}
        destructive={pending?.kind === "lock"}
        onConfirm={() => (pending ? run(pending.kind, pending.user) : undefined)}
      />
      {reset ? <ResetPasswordDialog result={reset} onClose={() => setReset(null)} /> : null}
    </>
  );
  return { onAction, dialogs };
}
