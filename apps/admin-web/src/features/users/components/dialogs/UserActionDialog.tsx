// ADM-FR-04, ADM-FR-05, ADM-FR-08 · hộp thoại xác nhận khoá / reset mật khẩu / đăng xuất mọi thiết bị / tắt 2FA của một user.
import type { User } from "@ai/contracts";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useTr } from "@/lib/use-translate";

export type PendingAction = { kind: "lock" | "reset" | "logoutAll" | "disable2fa"; user: User };

const TEXT = {
  lock: { title: "users.lock.title", body: "users.lock.body", submit: "users.lock.submit" },
  reset: { title: "users.reset.title", body: "users.reset.body", submit: "users.reset.submit" },
  logoutAll: {
    title: "users.logoutAll.title",
    body: "users.logoutAll.body",
    submit: "users.logoutAll.submit",
  },
  disable2fa: {
    title: "users.reset2fa.title",
    body: "users.reset2fa.body",
    submit: "users.reset2fa.submit",
  },
} as const;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: PendingAction | null;
  onConfirm: () => void | Promise<void>;
};

export function UserActionDialog({ open, onOpenChange, pending, onConfirm }: Props) {
  const tr = useTr();
  const cfg = TEXT[pending?.kind ?? "lock"];
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={tr(cfg.title, { username: pending?.user.username ?? "" })}
      description={tr(cfg.body)}
      confirmLabel={tr(cfg.submit)}
      destructive={pending?.kind === "lock" || pending?.kind === "disable2fa"}
      onConfirm={onConfirm}
    />
  );
}
