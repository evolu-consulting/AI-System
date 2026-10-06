// HUB-FR-72 · menu Tài khoản: tên người dùng, đổi ngôn ngữ (D10, nhớ `studio.locale`), Đăng xuất.
import { SUPPORTED_LOCALES } from "@ai/i18n/locales";
import { ChevronDown, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "#/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { useLogout } from "../hooks/use-logout";
import { useMe } from "../hooks/use-me";

const LOCALE_NAMES: Record<string, string> = { vi: "Tiếng Việt", en: "English" };

export function UserMenu() {
  const { t, i18n } = useTranslation();
  const me = useMe();
  const { logout, busy } = useLogout();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={t("user.account")}>
          <UserRound aria-hidden className="size-4" />
          <span className="max-w-40 truncate">{me?.display_name ?? t("user.account")}</span>
          <ChevronDown aria-hidden className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        {me ? (
          <DropdownMenuLabel className="font-normal">
            <span className="block font-medium text-foreground">{me.display_name}</span>
            <span className="block font-mono text-label text-muted-foreground">
              {`${me.tenant_key} · ${me.username}`}
            </span>
          </DropdownMenuLabel>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-label text-muted-foreground">
          {t("user.language")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={i18n.language}
          onValueChange={(lng) => void i18n.changeLanguage(lng)}
        >
          {SUPPORTED_LOCALES.map((lng) => (
            <DropdownMenuRadioItem key={lng} value={lng}>
              {LOCALE_NAMES[lng] ?? lng}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={busy} onSelect={() => void logout()}>
          {t("user.logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
