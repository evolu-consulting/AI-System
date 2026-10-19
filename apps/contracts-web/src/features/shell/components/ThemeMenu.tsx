// PK-FR-10 · TF5 · menu "Giao diện": Sáng · Tối · Theo máy (đặt `html[data-theme]`, nhớ theo trình duyệt).
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/utils";
import { type Theme, useTheme } from "../lib/theme";
import { Popover } from "./Popover";

const OPTIONS: readonly [Theme, string][] = [
  ["light", "contracts.shell.themeLight"],
  ["dark", "contracts.shell.themeDark"],
  ["auto", "contracts.shell.themeAuto"],
];

const ThemeIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="8" />
    <path d="M12 4v16a8 8 0 0 0 0-16z" fill="currentColor" />
  </svg>
);

export function ThemeMenu() {
  const { t } = useTranslation();
  const [theme, setTheme] = useTheme();
  return (
    <Popover label={t("contracts.shell.theme")} role="menu" button={<ThemeIcon />}>
      {(close) => (
        <div className="py-1">
          {OPTIONS.map(([v, key]) => (
            <button
              key={v}
              type="button"
              role="menuitem"
              onClick={() => {
                setTheme(v);
                close();
              }}
              className={cn(
                "flex w-full px-4 py-2.5 text-left text-label hover:bg-sunk",
                theme === v && "bg-act-soft font-semibold text-act",
              )}
            >
              {t(key)}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}
