// ADM-FR-01, ADM-FR-03, ADM-FR-08 · menu avatar: Đổi mật khẩu · Xác thực hai bước (không cho member, AC12) · Giao diện + Ngôn ngữ (PrefsPanel dùng chung) · Đăng xuất.
import { PrefsPanel } from "@ai/web-kit/ui/PrefsPanel";
import { Link } from "@tanstack/react-router";
import { KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSession } from "@/lib/auth/use-session";
import { useAccountActions } from "../hooks/use-account-actions";

export function AccountMenu() {
  const { t } = useTranslation();
  const name = useSession((s) => s.me?.display_name ?? "");
  const role = useSession((s) => s.me?.role ?? "");
  const { signOut } = useAccountActions();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("account.menu")} className="rounded-full">
          <span
            aria-hidden
            className="grid size-8 place-items-center rounded-full bg-accent text-label font-semibold text-accent-foreground"
          >
            {name.charAt(0).toUpperCase()}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="px-3 py-2 font-normal">
          <p className="truncate text-label font-semibold text-foreground">{name}</p>
          <p className="truncate text-caption text-muted-foreground">{role}</p>
        </DropdownMenuLabel>
        <PrefsPanel />
        <DropdownMenuItem asChild>
          <Link to="/account/password" className="gap-2.5">
            <KeyRound size={16} aria-hidden /> {t("account.changePassword")}
          </Link>
        </DropdownMenuItem>
        {role === "member" ? null : (
          <DropdownMenuItem asChild>
            <Link to="/account/2fa" className="gap-2.5">
              <ShieldCheck size={16} aria-hidden /> {t("account.twofa")}
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()} className="gap-2.5">
          <LogOut size={16} aria-hidden /> {t("auth.logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
