// ADM-FR-75 · hành động trên tài khoản đối tác: thêm (mật khẩu tạm một lần), đặt lại mật khẩu, khoá/mở khoá, vô hiệu (có xác nhận).
import type { TempPasswordResponse, User } from "@ai/contracts";
import { type ReactNode, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { notifySuccess } from "@/components/shared/toast";
import {
  ResetPasswordDialog,
  type ResetResult,
} from "@/features/users/components/dialogs/ResetPasswordDialog";
import { useTr } from "@/lib/use-translate";
import { useCreateOrgUser, useDeactivateOrgUser, usePartnerUserAction } from "../api";
import { PartnerUserDialog } from "../components/PartnerUserDialog";
import type { PartnerUserActionKind } from "../lib/status";
import { useReportError } from "./use-report-error";

type Confirm = { kind: "resetPassword" | "lock" | "deactivate"; user: User };

const TEXT = {
  resetPassword: {
    title: "partners.user.reset.title",
    body: "partners.user.reset.body",
    submit: "partners.user.reset.submit",
  },
  lock: {
    title: "partners.user.lock.title",
    body: "partners.user.lock.body",
    submit: "partners.user.lock.submit",
  },
  deactivate: {
    title: "partners.user.deactivate.title",
    body: "partners.user.deactivate.body",
    submit: "partners.user.deactivate.submit",
  },
} as const;

type Shown = { result: ResetResult; created: boolean };

/** `tenantKey` = mã công ty trong khối mật khẩu tạm (khách đăng nhập bằng mã này). */
export function usePartnerUserActions(
  orgId: string,
  tenantKey: string,
): {
  openCreate: () => void;
  onAction: (k: PartnerUserActionKind, u: User) => void;
  dialogs: ReactNode;
} {
  const { t } = useTranslation();
  const tr = useTr();
  const report = useReportError();
  const create = useCreateOrgUser(orgId);
  const deactivate = useDeactivateOrgUser(orgId);
  const act = usePartnerUserAction();
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<Shown | null>(null);

  const run = useCallback(
    async (kind: PartnerUserActionKind, user: User) => {
      try {
        if (kind === "deactivate") {
          await deactivate.mutateAsync(user.id);
          notifySuccess(t("partners.toast.userDeactivated", { username: user.username }));
        } else if (kind === "resetPassword") {
          const res = (await act.mutateAsync({
            id: user.id,
            action: "reset-password",
          })) as TempPasswordResponse;
          setShown({
            created: false,
            result: { tenantKey, username: user.username, password: res.temp_password },
          });
        } else {
          await act.mutateAsync({ id: user.id, action: kind });
          const key = kind === "lock" ? "partners.toast.userLocked" : "partners.toast.userUnlocked";
          notifySuccess(t(key, { username: user.username }));
        }
      } catch (err) {
        report(err);
        throw err; // giữ hộp thoại xác nhận mở
      }
    },
    [act, deactivate, report, t, tenantKey],
  );

  const onAction = useCallback(
    (kind: PartnerUserActionKind, user: User) => {
      if (kind === "unlock") {
        void run(kind, user).catch(() => undefined);
        return;
      }
      setConfirm({ kind, user });
      setOpen(true);
    },
    [run],
  );

  const submitCreate = async (v: Parameters<typeof create.mutateAsync>[0]) => {
    const res = await create.mutateAsync(v);
    notifySuccess(t("partners.toast.userCreated", { username: res.user.username }));
    setAdding(false);
    setShown({
      created: true,
      result: { tenantKey, username: res.user.username, password: res.temp_password },
    });
  };

  const cfg = TEXT[confirm?.kind ?? "lock"];
  const dialogs = (
    <>
      {adding ? (
        <PartnerUserDialog
          onSubmit={submitCreate}
          onError={report}
          onClose={() => setAdding(false)}
        />
      ) : null}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={tr(cfg.title, { username: confirm?.user.username ?? "" })}
        description={tr(cfg.body)}
        confirmLabel={tr(cfg.submit)}
        destructive={confirm?.kind !== "resetPassword"}
        onConfirm={() => (confirm ? run(confirm.kind, confirm.user) : undefined)}
      />
      {shown ? (
        <ResetPasswordDialog
          result={shown.result}
          title={
            shown.created
              ? t("partners.user.created", { username: shown.result.username })
              : undefined
          }
          onClose={() => setShown(null)}
        />
      ) : null}
    </>
  );
  return { openCreate: () => setAdding(true), onAction, dialogs };
}
