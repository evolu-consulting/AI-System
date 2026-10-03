import { describe, expect, test } from "bun:test";
import { applyResolved, parseTheme, resolve } from "./theme";

describe("theme", () => {
  test("parseTheme: giá trị lạ hoặc null → system", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("system")).toBe("system");
    expect(parseTheme("x")).toBe("system");
    expect(parseTheme(null)).toBe("system");
  });
  test("resolve: system theo hệ thống, còn lại giữ nguyên", () => {
    expect(resolve("system", true)).toBe("dark");
    expect(resolve("system", false)).toBe("light");
    expect(resolve("light", true)).toBe("light");
    expect(resolve("dark", false)).toBe("dark");
  });
  test("applyResolved: bật/tắt class dark và color-scheme", () => {
    const classes = new Set<string>();
    const root = {
      classList: {
        toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)),
      },
      style: { colorScheme: "" },
    } as unknown as HTMLElement;
    applyResolved("dark", root);
    expect(classes.has("dark")).toBe(true);
    expect(root.style.colorScheme).toBe("dark");
    applyResolved("light", root);
    expect(classes.has("dark")).toBe(false);
    expect(root.style.colorScheme).toBe("light");
  });
});
