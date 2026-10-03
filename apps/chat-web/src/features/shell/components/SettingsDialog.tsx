// CHAT-AC-04, CHAT-AC-36 · Cài đặt tối thiểu (ui-chat §7): Ngôn ngữ, Tài khoản (tên, công ty), dòng Quyền riêng tư, Đăng xuất.
// Trình bày thuần: nhận dữ liệu + callback qua props. Nhóm "Giao diện" (F14): RadioGroup Sáng/Tối/Theo hệ thống, áp ngay.
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import type { ThemeMode } from "~/lib/theme";

export type UiLanguage = "vi" | "en";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  language: UiLanguage;
  onLanguageChange: (lang: UiLanguage) => void;
  theme: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  displayName: string;
  username: string;
  tenantName: string;
  loggingOut: boolean;
  onLogout: () => void;
};

const LANGS: { value: UiLanguage; key: string }[] = [
  { value: "vi", key: "settings.langVi" },
  { value: "en", key: "settings.langEn" },
];

const THEMES: { value: ThemeMode; key: string }[] = [
  { value: "light", key: "settings.themeLight" },
  { value: "dark", key: "settings.themeDark" },
  { value: "system", key: "settings.themeSystem" },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-label font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function LanguageGroup({
  language,
  onLanguageChange,
}: Pick<Props, "language" | "onLanguageChange">) {
  const { t } = useTranslation();
  return (
    <fieldset className="flex gap-4">
      <legend className="sr-only">{t("settings.language")}</legend>
      {LANGS.map((l) => (
        <label key={l.value} className="flex items-center gap-2 text-body text-foreground">
          <input
            type="radio"
            name="chat-language"
            value={l.value}
            checked={language === l.value}
            onChange={() => onLanguageChange(l.value)}
            className="size-4 accent-primary"
          />
          {t(l.key)}
        </label>
      ))}
    </fieldset>
  );
}

function ThemeGroup({ theme, onThemeChange }: Pick<Props, "theme" | "onThemeChange">) {
  const { t } = useTranslation();
  return (
    <RadioGroup
      aria-label={t("settings.theme")}
      value={theme}
      onValueChange={(v) => onThemeChange(v as ThemeMode)}
      className="flex flex-wrap gap-4"
    >
      {THEMES.map((o) => (
        <div key={o.value} className="flex items-center gap-2">
          <RadioGroupItem value={o.value} id={`theme-${o.value}`} />
          <Label htmlFor={`theme-${o.value}`} className="text-body font-normal text-foreground">
            {t(o.key)}
          </Label>
        </div>
      ))}
    </RadioGroup>
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
          <Section title={t("settings.language")}>
            <LanguageGroup language={props.language} onLanguageChange={props.onLanguageChange} />
          </Section>
          <Section title={t("settings.theme")}>
            <ThemeGroup theme={props.theme} onThemeChange={props.onThemeChange} />
          </Section>
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
