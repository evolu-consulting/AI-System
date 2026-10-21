// ADM-FR-01, ADM-FR-03, ADM-FR-08 · menu avatar: Đổi mật khẩu · Xác thực hai bước (không cho member, AC12) · Giao diện + Ngôn ngữ (PrefsPanel dùng chung) · Đăng xuất.
import { PrefsPanel } from "@ai/web-kit/ui/PrefsPanel";
import { Link } from "@tanstack/react-router";
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
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate text-label font-medium text-foreground">{name}</p>
          <p className="truncate text-caption text-muted-foreground">{role}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/account/password">{t("account.changePassword")}</Link>
        </DropdownMenuItem>
        {role === "member" ? null : (
          <DropdownMenuItem asChild>
            <Link to="/account/2fa">{t("account.twofa")}</Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <PrefsPanel />
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>{t("auth.logout")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
