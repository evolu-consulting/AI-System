// prefs-sync · thứ tự chọn (me → localStorage → mặc định vi + light) và luồng đổi → áp + nhớ + PATCH.
import { describe, expect, test } from "bun:test";
import { applyTheme, createPrefs, DEFAULT_PREFS, resolvePrefs, resolveTheme } from "./prefs";

const mem = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    m,
  };
};

describe("resolvePrefs", () => {
  test("mặc định vi + light", () => {
    expect(resolvePrefs({})).toEqual(DEFAULT_PREFS);
    expect(DEFAULT_PREFS).toEqual({ locale: "vi", theme: "light" });
  });
  test("me thắng localStorage; thiếu thì lấy localStorage; giá trị lạ bị bỏ", () => {
    expect(
      resolvePrefs({
        me: { locale: "en", theme: "dark" },
        stored: { locale: "vi", theme: "light" },
      }),
    ).toEqual({ locale: "en", theme: "dark" });
    expect(
      resolvePrefs({ me: { locale: "xx" }, stored: { locale: "en", theme: "system" } }),
    ).toEqual({
      locale: "en",
      theme: "system",
    });
  });
  test("system theo máy", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("createPrefs", () => {
  test("init áp bản nhớ; reconcile theo /me; set gọi PATCH và nhớ", async () => {
    const st = mem({ "ai.theme": "dark" });
    const p = createPrefs(st);
    const langs: string[] = [];
    const patches: unknown[] = [];
    p.init({
      applyLocale: (l) => void langs.push(l),
      patch: async (b) => void patches.push(b),
    });
    expect(p.get()).toEqual({ locale: "vi", theme: "dark" });
    p.reconcile({ locale: "en", theme: "light" });
    expect(p.get()).toEqual({ locale: "en", theme: "light" });
    expect(langs).toEqual(["en"]);
    expect(st.m.get("ai.theme")).toBe("light");
    await p.set({ theme: "dark" });
    expect(patches).toEqual([{ theme: "dark" }]);
    expect(st.m.get("ai.theme")).toBe("dark");
    expect(p.get().locale).toBe("en");
  });
  test("PATCH lỗi vẫn giữ lựa chọn cục bộ", async () => {
    const p = createPrefs(mem());
    p.init({ applyLocale: () => {}, patch: () => Promise.reject(new Error("offline")) });
    await p.set({ locale: "en" });
    expect(p.get().locale).toBe("en");
  });
});

describe("applyTheme", () => {
  test("đặt class dark + data-theme + color-scheme", () => {
    const cls = new Set<string>();
    const root = {
      classList: { toggle: (c: string, on: boolean) => void (on ? cls.add(c) : cls.delete(c)) },
      dataset: {} as Record<string, string | undefined>,
      style: { colorScheme: "" },
    };
    applyTheme("dark", root, false);
    expect([cls.has("dark"), root.dataset.theme, root.style.colorScheme]).toEqual([
      true,
      "dark",
      "dark",
    ]);
    applyTheme("system", root, false);
    expect([cls.has("dark"), root.dataset.theme]).toEqual([false, "light"]);
  });
});
