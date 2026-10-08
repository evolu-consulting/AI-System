// ADM-FR-01 · công tắc VI/EN ở trang đăng nhập (chỉ đổi cục bộ, chưa gọi server).
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { code: "en", short: "EN" },
  { code: "vi", short: "VI" },
] as const;

export function LanguageSwitch() {
  const { t, i18n } = useTranslation();
  return (
    <fieldset className="flex gap-1 border-0 p-0">
      <legend className="sr-only">{t("auth.lang.group")}</legend>
      {OPTIONS.map(({ code, short }) => {
        const active = i18n.language === code;
        return (
          <button
            key={code}
            type="button"
            aria-pressed={active}
            aria-label={code === "vi" ? t("auth.lang.vi") : t("auth.lang.en")}
            onClick={() => void i18n.changeLanguage(code)}
            className={cn(
              "h-8 rounded-md border border-input px-2.5 text-label focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
              active
                ? "bg-accent font-semibold text-accent-foreground"
                : "bg-card text-muted-strong-foreground hover:bg-muted",
            )}
          >
            {short}
          </button>
        );
      })}
    </fieldset>
  );
}
