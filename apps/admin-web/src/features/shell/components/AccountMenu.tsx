// ADM-FR-01, ADM-FR-03, ADM-FR-08 · menu avatar: Đổi mật khẩu · Xác thực hai bước (không cho member, AC12) · Giao diện + Ngôn ngữ (PrefsPanel dùng chung) · Đăng xuất.
import { PrefsPanel } from "@ai/web-kit/ui/PrefsPanel";
import { Link } from "@tanstack/react-router";
import { KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/shared/IconButton";
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
        <IconButton
          label={t("account.menu")}
          className="size-9 rounded-full"
          data-testid="account-menu"
        >
          <span
            aria-hidden
            className="grid size-7 place-items-center rounded-full bg-primary text-caption font-semibold text-primary-foreground"
          >
            {name.charAt(0).toUpperCase()}
          </span>
        </IconButton>
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
