// CHAT-AC-03, CHAT-AC-04 · layout tạm của vùng đăng nhập (F4): nút "Cài đặt" + Outlet; F6 thay bằng AppShell (sidebar 260px).
import { Outlet } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { useSessionRedirect } from "~/features/auth/hooks/use-session-redirect";
import { useSettings } from "../hooks/use-settings";
import { SettingsDialog } from "./SettingsDialog";

export function AuthedLayout() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const settings = useSettings();
  useSessionRedirect();
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex justify-end p-3">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
          <Settings aria-hidden />
          {t("shell.settings")}
        </Button>
      </header>
      <main id="main" className="flex flex-1 flex-col">
        <Outlet />
      </main>
      <SettingsDialog open={open} onOpenChange={setOpen} {...settings} />
    </div>
  );
}
