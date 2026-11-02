// COM-FR-31 · khung hộp thoại "Cài đặt chung": mở từ user-menu hoặc `#/settings`, KHÔNG phải route (đóng giữ nguyên trang nền).
// Esc / bấm nền / nút đóng đóng. Thân hộp thoại tạm là màn Cài đặt hiện có; lát cr110-settings thay bằng nav 3 nhóm theo quyền.
import { useEffect, useRef } from "react";
import { t } from "../i18n";
import { useApp } from "./ctx";
import { IconX } from "./icons";
import { SettingsPage } from "./Settings";

export function SettingsDialog() {
  const { settingsOpen, closeSettings } = useApp();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!settingsOpen) return;
    const prev = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSettings();
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      prev?.focus?.();
    };
  }, [settingsOpen, closeSettings]);
  if (!settingsOpen) return null;
  return (
    <div className="dlg-scrim">
      <button
        type="button"
        className="dlg-bg"
        tabIndex={-1}
        aria-label={t("community.settings.close")}
        onClick={closeSettings}
      />
      <div
        ref={box}
        className="dlg setdlg"
        role="dialog"
        aria-modal="true"
        aria-label={t("community.settings.title")}
        tabIndex={-1}
      >
        <header className="dlg-head">
          <h2>{t("community.settings.title")}</h2>
          <button
            type="button"
            className="iconbtn"
            aria-label={t("community.settings.close")}
            onClick={closeSettings}
          >
            <IconX size={18} />
          </button>
        </header>
        <div className="dlg-body">
          <SettingsPage />
        </div>
      </div>
    </div>
  );
}
