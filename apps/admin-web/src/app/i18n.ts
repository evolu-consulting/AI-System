// ADM-NFR-06, ADM-FR-01 · khởi tạo i18next; CR-052: `ai.locale` đã lưu, không có thì en (không dò trình duyệt), `<html lang>` đi theo ngôn ngữ đang dùng.
import { DEFAULT_LOCALE, type Locale, loadLocale, SUPPORTED_LOCALES } from "@ai/i18n/locales";
import { loadProcessLocale, toSingleBrace } from "@ai/i18n/process-locales";
import { LOCALE_KEY, resolvePrefs } from "@ai/web-kit/prefs/prefs";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";

export const LOCALE_STORAGE_KEY = LOCALE_KEY;

type DocLike = { documentElement: { lang: string } };
type StorageLike = Pick<Storage, "getItem">;

/** Đặt `lang` của trang theo ngôn ngữ `lng` (CR-051: tiêu đề tab cố định "Evolu Control" — `rsbuild.config.ts` html.title). */
export function syncDocument(doc: DocLike, lng: string): void {
  doc.documentElement.lang = lng;
}

const isSupported = (v: string | null | undefined): v is (typeof SUPPORTED_LOCALES)[number] =>
  SUPPORTED_LOCALES.some((l) => l === v);

/** prefs-sync · `ai.locale` đã lưu → `vi` (mặc định chung 4 web; không dò ngôn ngữ trình duyệt). Khi có phiên, `/me` thắng (prefs.reconcile). */
export function resolveInitialLocale(
  storage: StorageLike | undefined,
): (typeof SUPPORTED_LOCALES)[number] {
  const saved = storage?.getItem(LOCALE_STORAGE_KEY);
  return resolvePrefs({ stored: { locale: saved } }).locale;
}

// Đăng ký trước `init` để lần init đầu cũng đặt `lang`; `bun test` không có `document`.
i18next.on("languageChanged", (lng) => {
  if (typeof document !== "undefined") syncDocument(document, lng);
  if (typeof localStorage !== "undefined") localStorage.setItem(LOCALE_STORAGE_KEY, lng);
});

// Backend tối thiểu: mỗi ngôn ngữ là một chunk riêng, nạp khi khởi tạo hoặc khi đổi ngôn ngữ (ADM-NFR-03).
const lazyBackend = {
  type: "backend" as const,
  init() {},
  read(lng: string, _ns: string, cb: (err: unknown, data?: Record<string, unknown>) => void) {
    if (!isSupported(lng)) return cb(null, {});
    loadLocale(lng as Locale).then(
      (r) => cb(null, r),
      (e) => cb(e),
    );
  },
};

/** Khởi tạo i18n; promise xong khi bản dịch đang dùng (và `vi` dự phòng) đã nạp → vẽ lần đầu không nháy key. */
export const initI18n = (): Promise<unknown> =>
  i18next
    .use(lazyBackend)
    .use(initReactI18next)
    .init({
      partialBundledLanguages: true,
      lng: resolveInitialLocale(typeof localStorage === "undefined" ? undefined : localStorage),
      fallbackLng: DEFAULT_LOCALE,
      supportedLngs: [...SUPPORTED_LOCALES],
      // Chuỗi dùng {tham_số} (plan-frontend §7), không phải {{...}} mặc định của i18next.
      interpolation: { prefix: "{", suffix: "}", escapeValue: false },
    });

export const i18n = i18next;

const processLoaded = new Map<string, Promise<void>>();

/**
 * P-a FD3: nạp chuỗi `process.*` (phần `common` + `admin` + `sources` + `knowledge`) của `lng` vào bundle đang dùng — chỉ gọi khi engine `on`
 * (`useProcessEngine`). Admin dùng `{x}` thay `{{x}}` nên đổi cú pháp tham số khi nạp.
 */
export function ensureProcessLocale(lng: string): Promise<void> {
  if (!isSupported(lng)) return Promise.resolve();
  let p = processLoaded.get(lng);
  if (!p) {
    p = loadProcessLocale(lng, ["common", "admin", "sources", "knowledge"]).then((bundle) => {
      i18next.addResourceBundle(lng, "translation", toSingleBrace(bundle), true, true);
    });
    p.catch(() => processLoaded.delete(lng));
    processLoaded.set(lng, p);
  }
  return p;
}
