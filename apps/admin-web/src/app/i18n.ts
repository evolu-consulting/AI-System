// ADM-NFR-06 · khởi tạo i18next; mặc định vi, `<html lang>` đi theo ngôn ngữ đang dùng.
import { DEFAULT_LOCALE, resources, SUPPORTED_LOCALES } from "@ai/i18n";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";

// Đăng ký trước `init` để lần init đầu cũng đặt `lang`; `bun test` không có `document`.
i18next.on("languageChanged", (lng) => {
  if (typeof document !== "undefined") document.documentElement.lang = lng;
});

i18next.use(initReactI18next).init({
  resources,
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: [...SUPPORTED_LOCALES],
  interpolation: { escapeValue: false },
});

export const i18n = i18next;
