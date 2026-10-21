// prefs-sync · giao diện (sáng/tối/theo máy) + ngôn ngữ theo NGƯỜI DÙNG, dùng chung 4 web (Chat, Sổ Hợp Tác, Quản trị, Studio).
// Nguồn thật ở server (`admin.users.locale/theme`, trả trong `/auth/me`); localStorage chỉ là bản nhớ đệm để vẽ ngay không nháy.
// Thứ tự: /me → localStorage → mặc định (vi + light). Mỗi lần đổi ở bất kỳ app nào: áp ngay, ghi localStorage, rồi PATCH /auth/me.
import type { Locale, Theme } from "@ai/contracts";

export type Prefs = { locale: Locale; theme: Theme };

export const LOCALE_KEY = "ai.locale";
export const THEME_KEY = "ai.theme";
export const DEFAULT_PREFS: Prefs = { locale: "vi", theme: "light" };

export const isLocale = (v: unknown): v is Locale => v === "vi" || v === "en";
export const isTheme = (v: unknown): v is Theme => v === "light" || v === "dark" || v === "system";

type StorageLike = Pick<Storage, "getItem" | "setItem">;
type Partial2 = { locale?: unknown; theme?: unknown };

/** Thứ tự chọn giá trị từng trường: `me` (server) → `stored` (localStorage) → mặc định. Giá trị lạ bị bỏ qua. */
export function resolvePrefs(src: { me?: Partial2 | null; stored?: Partial2 | null }): Prefs {
  const pick = <K extends keyof Prefs>(k: K, ok: (v: unknown) => v is Prefs[K]): Prefs[K] => {
    const a = src.me?.[k];
    if (ok(a)) return a;
    const b = src.stored?.[k];
    if (ok(b)) return b;
    return DEFAULT_PREFS[k];
  };
  return { locale: pick("locale", isLocale), theme: pick("theme", isTheme) };
}

function defaultStorage(): StorageLike | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined; // chế độ riêng tư / chặn site data: accessor có thể ném
  }
}

/** Giá trị đã nhớ (có thể thiếu); storage hỏng ⇒ rỗng. */
export function readStored(storage: StorageLike | undefined = defaultStorage()): {
  locale: string | null;
  theme: string | null;
} {
  try {
    return {
      locale: storage?.getItem(LOCALE_KEY) ?? null,
      theme: storage?.getItem(THEME_KEY) ?? null,
    };
  } catch {
    return { locale: null, theme: null };
  }
}

export function writeStored(
  patch: Partial<Prefs>,
  storage: StorageLike | undefined = defaultStorage(),
): void {
  try {
    if (patch.locale) storage?.setItem(LOCALE_KEY, patch.locale);
    if (patch.theme) storage?.setItem(THEME_KEY, patch.theme);
  } catch {
    // không lưu được: vẫn đổi trong phiên
  }
}

export const resolveTheme = (theme: Theme, systemDark: boolean): "light" | "dark" =>
  theme === "system" ? (systemDark ? "dark" : "light") : theme;

type RootLike = {
  classList: { toggle(c: string, on: boolean): unknown };
  dataset: Record<string, string | undefined>;
  style: { colorScheme: string };
};

const DARK_QUERY = "(prefers-color-scheme: dark)";
const systemIsDark = (): boolean =>
  typeof matchMedia === "function" && matchMedia(DARK_QUERY).matches;

/** Áp lên `<html>`: class `dark` (Tailwind: admin/chat/studio) + `data-theme` (Sổ Hợp Tác) + `color-scheme`. */
export function applyTheme(
  theme: Theme,
  root: RootLike | undefined = typeof document === "undefined"
    ? undefined
    : document.documentElement,
  systemDark: boolean = systemIsDark(),
): void {
  if (!root) return;
  const r = resolveTheme(theme, systemDark);
  root.classList.toggle("dark", r === "dark");
  root.dataset.theme = r;
  root.style.colorScheme = r;
}

export type PrefsDeps = {
  /** Đổi ngôn ngữ giao diện của app (thường `i18n.changeLanguage`). */
  applyLocale: (l: Locale) => unknown;
  /** `PATCH /auth/me` bằng client HTTP của app; lỗi được nuốt (đã áp cục bộ). */
  patch: (body: Partial<Prefs>) => Promise<unknown>;
};

type Listener = () => void;

export function createPrefs(storage?: StorageLike) {
  let deps: PrefsDeps | null = null;
  let state: Prefs = resolvePrefs({ stored: readStored(storage) });
  let pending = 0;
  const listeners = new Set<Listener>();
  let unwatch: (() => void) | null = null;

  const emit = () => {
    for (const l of listeners) l();
  };
  const apply = (next: Prefs, applyLang: boolean) => {
    const langChanged = next.locale !== state.locale;
    state = next;
    applyTheme(next.theme);
    if (applyLang && langChanged) void deps?.applyLocale(next.locale);
    emit();
  };
  const watchSystem = () => {
    unwatch?.();
    unwatch = null;
    if (state.theme !== "system" || typeof matchMedia !== "function") return;
    const m = matchMedia(DARK_QUERY);
    const on = () => applyTheme(state.theme);
    m.addEventListener("change", on);
    unwatch = () => m.removeEventListener("change", on);
  };

  return {
    get: (): Prefs => state,
    subscribe(l: Listener): () => void {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    /** Gọi một lần lúc khởi động app: áp bản đã nhớ (hoặc mặc định) ngay, trước khi `/me` trả về. */
    init(d: PrefsDeps): void {
      deps = d;
      state = resolvePrefs({ stored: readStored(storage) });
      applyTheme(state.theme);
      watchSystem();
      emit();
    },
    /** `/me` về (đăng nhập, SSO, refresh): server thắng; ghi nhớ đệm. Bỏ qua khi người dùng vừa đổi mà PATCH chưa xong. */
    reconcile(me: Partial2 | null | undefined): void {
      if (!me || pending > 0) return;
      const next = resolvePrefs({ me, stored: readStored(storage) });
      writeStored(next, storage);
      apply(next, true);
      watchSystem();
    },
    /** Người dùng đổi ở menu tài khoản: áp + nhớ + PATCH server. */
    async set(patch: Partial<Prefs>): Promise<void> {
      const next = resolvePrefs({ me: patch, stored: state });
      writeStored(next, storage);
      apply(next, true);
      watchSystem();
      pending += 1;
      try {
        await deps?.patch(patch);
      } catch {
        // offline/401: giữ lựa chọn cục bộ; lần đăng nhập sau server sẽ thắng
      } finally {
        pending -= 1;
      }
    },
  };
}

/** Một bản duy nhất cho mỗi app (mỗi bundle). */
export const prefs = createPrefs();
