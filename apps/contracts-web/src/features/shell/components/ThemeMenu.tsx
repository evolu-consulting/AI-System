// PK-FR-10 · TF5 · "Giao diện": công tắc 3 chiều Sáng · Tối · Theo máy trong menu tài khoản (như mgmt-app TopBar.tsx ThemePicker, D-02).
import { useTranslation } from "react-i18next";
import { type Theme, useTheme } from "../lib/theme";

const OPTIONS: readonly [Theme, string][] = [
  ["light", "contracts.shell.themeLight"],
  ["dark", "contracts.shell.themeDark"],
  ["auto", "contracts.shell.themeAuto"],
];

export function ThemePicker() {
  const { t } = useTranslation();
  const [theme, setTheme] = useTheme();
  return (
    <div className="flex items-center gap-3 border-b border-rule-soft px-4 py-2.5 text-[13.5px]">
      <span className="text-ink-2">{t("contracts.shell.theme")}</span>
      <span
        role="radiogroup"
        aria-label={t("contracts.shell.theme")}
        className="ml-auto inline-flex rounded-lg border border-rule p-0.5"
      >
        {OPTIONS.map(([v, key]) => (
          // biome-ignore lint/a11y/useSemanticElements: nút dạng radio như mgmt-app (D-02)
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={theme === v}
            onClick={() => setTheme(v)}
            className={`rounded-md px-2.5 py-1 text-[12.5px] ${theme === v ? "bg-act-soft font-semibold text-act" : "text-dim hover:text-ink"}`}
          >
            {t(key)}
          </button>
        ))}
      </span>
    </div>
  );
}
