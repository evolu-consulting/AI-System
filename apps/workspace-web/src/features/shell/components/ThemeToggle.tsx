// CR-120 · công tắc sáng/tối MỘT nút biểu tượng (mặt trời/mặt trăng) ở thanh trên dùng chung; lưu như cũ qua prefs-sync (`prefs.set`).
// `aria-pressed` = đang ở chế độ tối (kể cả "theo máy" khi máy tối).
import { prefs } from "@ai/web-kit/prefs/prefs";
import { usePrefs } from "@ai/web-kit/ui/PrefsPanel";
import { Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";

/** Giao diện đang HIỆU LỰC trên trang (lựa chọn riêng > mặc định công ty > theo máy) — đọc từ `html[data-theme]`. */
/** `_theme` chỉ để vẽ lại khi đổi lựa chọn (React Compiler không ghi nhớ kết quả khi tham số đổi). */
const isDark = (_theme: string): boolean => document.documentElement.dataset.theme === "dark";

export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { theme } = usePrefs(); // đổi giao diện ở đâu cũng vẽ lại
  const dark = isDark(theme);
  const label = t("contracts.shell.themeToggle");
  return (
    <button
      type="button"
      data-testid="theme-toggle"
      aria-label={label}
      title={label}
      aria-pressed={dark}
      onClick={() => void prefs.set({ theme: dark ? "light" : "dark" })}
      className={className}
    >
      {dark ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
    </button>
  );
}
