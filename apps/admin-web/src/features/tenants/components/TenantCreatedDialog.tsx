// ADM-FR-60 · hộp thoại sau khi tạo tenant: mật khẩu tạm hiện một lần; không đóng bằng Esc/click nền/nút X (D10).
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { TempPasswordPanel } from "@/components/shared/TempPasswordPanel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

type Props = {
  tenantKey: string;
  username: string;
  password: string;
  onContinue: () => void;
};

export function TenantCreatedDialog({ tenantKey, username, password, onContinue }: Props) {
  const { t } = useTranslation();
  const [acked, setAcked] = useState(false);

  // Mật khẩu chỉ hiện một lần: cảnh báo khi người dùng đóng hoặc tải lại tab.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t("tempPassword.titleTenant", { key: tenantKey })}</DialogTitle>
          <DialogDescription>{t("tempPassword.body")}</DialogDescription>
        </DialogHeader>
        <TempPasswordPanel tenantKey={tenantKey} username={username} password={password} />
        <p className="text-caption text-muted-foreground">{t("users.create.passwordNote")}</p>
        <div className="flex items-center gap-2">
          <Checkbox id="temp-ack" checked={acked} onCheckedChange={(v) => setAcked(v === true)} />
          <Label htmlFor="temp-ack">{t("tempPassword.ack")}</Label>
        </div>
        <DialogFooter>
          <Button disabled={!acked} onClick={onContinue}>
            {t("tenants.new.goTo")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
