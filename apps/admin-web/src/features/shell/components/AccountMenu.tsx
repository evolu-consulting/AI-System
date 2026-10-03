// ADM-FR-01, ADM-FR-03 · menu avatar: Đổi mật khẩu · Xác thực hai bước · Ngôn ngữ (menuitemradio) · Đăng xuất.
import type { Locale } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSession } from "@/lib/auth/use-session";
import { useAccountActions } from "../hooks/use-account-actions";

export function AccountMenu() {
  const { t, i18n } = useTranslation();
  const name = useSession((s) => s.me?.display_name ?? "");
  const role = useSession((s) => s.me?.role ?? "");
  const { changeLocale, signOut } = useAccountActions();
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
        <DropdownMenuItem asChild>
          <Link to={"/account/2fa" as "/"}>{t("account.twofa")}</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-caption text-muted-foreground">
          {t("account.language")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={i18n.language}
          onValueChange={(v) => void changeLocale(v as Locale)}
        >
          <DropdownMenuRadioItem value="vi">{t("auth.lang.vi")}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="en">{t("auth.lang.en")}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>{t("auth.logout")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
