// sso-switch · nút "Ứng dụng" của AI System: mở Sổ Hợp Tác / Quản trị theo vai + gói. Mỗi mục là link thật tới `/sso?app=…`
// của chính chat-web (xin mã một lần ⇒ sang app đích đã đăng nhập sẵn, không đăng nhập lại).
import { LayoutGrid } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { useSession } from "~/lib/auth/use-session";
import { cn } from "~/lib/utils";
import { useContractsEnabled } from "../hooks/use-contracts-enabled";
import { APP_URLS, type SwitchApp, visibleApps } from "../lib/apps";

const LABEL: Record<SwitchApp, string> = {
  contracts: "shell.appContracts",
  admin: "shell.appAdmin",
};

export function AppSwitcher({ className }: { className?: string }) {
  const { t } = useTranslation();
  const role = useSession((s) => s.me?.role);
  const contractsEnabled = useContractsEnabled(APP_URLS.contracts !== "");
  const apps = visibleApps({ urls: APP_URLS, role, contractsEnabled });
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  if (apps.length === 0) return null;
  return (
    <div ref={box} className={cn("relative", className)}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t("shell.apps")}
        title={t("shell.apps")}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="size-8 text-muted-foreground"
      >
        <LayoutGrid aria-hidden />
      </Button>
      {open && (
        <ul
          id={panelId}
          aria-label={t("shell.apps")}
          className="absolute top-9 right-0 z-50 min-w-44 rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-md"
        >
          {apps.map((a) => (
            <li key={a}>
              <a
                href={`/sso?${new URLSearchParams({ app: a })}`}
                className="flex h-9 items-center rounded-md px-2.5 outline-none hover:bg-muted focus-visible:bg-muted"
              >
                {t(LABEL[a])}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
