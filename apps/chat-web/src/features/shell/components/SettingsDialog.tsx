// CHAT-AC-04, CHAT-AC-36 · Cài đặt tối thiểu (ui-chat §7): Giao diện + Ngôn ngữ (PrefsPanel dùng chung), Tài khoản (tên, công ty), dòng Quyền riêng tư, Đăng xuất.
// Trình bày thuần: nhận dữ liệu + callback qua props.

import { PrefsPanel } from "@ai/web-kit/ui/PrefsPanel";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  displayName: string;
  username: string;
  tenantName: string;
  loggingOut: boolean;
  onLogout: () => void;
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-label font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

export function SettingsDialog(props: Props) {
  const { t } = useTranslation();
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("settings.title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("settings.title")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="-mx-4">
            <PrefsPanel />
          </div>
          <Section title={t("settings.account")}>
            <div className="space-y-1 text-body text-foreground">
              <p>
                {props.displayName}{" "}
                <span className="text-muted-foreground">· {props.username}</span>
              </p>
              <p>
                <span className="text-muted-foreground">{t("settings.company")}: </span>
                {props.tenantName}
              </p>
            </div>
          </Section>
          <p className="text-caption text-muted-foreground">{t("settings.privacy")}</p>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={props.loggingOut}
            onClick={props.onLogout}
          >
            {t("settings.logout")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
