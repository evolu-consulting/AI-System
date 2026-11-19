// CR-187 BR-187-1 · hộp «Đổi mật khẩu» mở tại chỗ (hiện tại / mới / nhập lại) — không chuyển sang trang quản trị.
// Sai mật khẩu hiện tại ⇒ lỗi ngay trong hộp; thành công ⇒ «Đã đổi mật khẩu» (phiên hiện tại giữ, thiết bị khác do API quyết).

import { Button } from "@ai/web-kit/ui/kit/button";
import { Input } from "@ai/web-kit/ui/kit/input";
import { PasswordStrength } from "@ai/web-kit/ui/PasswordStrength";
import { toast } from "@ai/web-kit/ui/toast";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { adminApiAuth } from "~/platform/auth/adapters/admin-api";
import { type PwField, submitChangePassword } from "../lib/change-password";

const FIELDS = ["current", "next", "confirm"] as const;
const AUTO = {
  current: "current-password",
  next: "new-password",
  confirm: "new-password",
} as const;

export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.gape.account.pw.${k}`, o);
  const [v, setV] = useState({ current: "", next: "", confirm: "" });
  const [err, setErr] = useState<{ field: PwField; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const r = await submitChangePassword(adminApiAuth, v);
    setBusy(false);
    if (r.ok) {
      toast(L("done"), "ok");
      return onClose();
    }
    setErr({ field: r.field, text: t(r.message.key, r.message.params) });
  };
  const label = { current: L("current"), next: L("next"), confirm: L("confirm") };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="change-password-dialog">
        <DialogHeader>
          <DialogTitle>{L("title")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-3">
          {FIELDS.map((f) => (
            <label key={f} className="block text-[13px]">
              {label[f]}
              <Input
                type="password"
                name={f}
                value={v[f]}
                autoComplete={AUTO[f]}
                aria-invalid={err?.field === f}
                onChange={(e) => setV({ ...v, [f]: e.target.value })}
              />
              {f === "next" && (
                <span className="mt-1 block text-caption text-dim">{L("hint")}</span>
              )}
              {f === "next" && (
                <PasswordStrength
                  value={v.next}
                  label={(level) => L("strength.label", { level: L(`strength.${level}`) })}
                />
              )}
              {err?.field === f && (
                <span role="alert" className="mt-1 block text-caption text-late">
                  {err.text}
                </span>
              )}
            </label>
          ))}
          {err?.field === "form" && (
            <p role="alert" className="text-caption text-late">
              {err.text}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              {L("cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {L("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
