// ADM-NFR-06 · khởi tạo i18next; mặc định vi, `<html lang>` và `document.title` đi theo ngôn ngữ đang dùng.
import { DEFAULT_LOCALE, resources, SUPPORTED_LOCALES } from "@ai/i18n";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";

type DocLike = { title: string; documentElement: { lang: string } };

/** Đặt `lang` và tiêu đề tab theo ngôn ngữ `lng`. */
export function syncDocument(doc: DocLike, lng: string): void {
  doc.documentElement.lang = lng;
  doc.title = i18next.t("app.meta.title", { lng });
}

// Đăng ký trước `init` để lần init đầu cũng đặt `lang`/title; `bun test` không có `document`.
i18next.on("languageChanged", (lng) => {
  if (typeof document !== "undefined") syncDocument(document, lng);
});

i18next.use(initReactI18next).init({
  resources,
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: [...SUPPORTED_LOCALES],
  interpolation: { escapeValue: false },
});

export const i18n = i18next;
