// CR-121 · token giao diện: mặc định sáng, theo máy, và khối .dark phải đổi cả token sidebar (lỗi cũ: sidebar không đổi màu khi tối).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DEFAULT_PREFS, resolveTheme } from "@ai/web-kit/prefs/prefs";

const css = readFileSync(new URL("../../../styles/globals.css", import.meta.url), "utf8");
const block = (sel: string) => {
  const m = new RegExp(`(^|\\n)${sel.replace(".", "\\.")} \\{([^}]*)\\}`).exec(css);
  return m?.[2] ?? "";
};

describe("CR-121 · giao diện shell", () => {
  test("mặc định Sáng; Theo máy lấy theo máy; Tối/Sáng cố định", () => {
    expect(DEFAULT_PREFS.theme).toBe("light");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });

  test("khối .dark định nghĩa lại mọi token sidebar có ở :root", () => {
    const names = [...block(":root").matchAll(/(--sidebar[\w-]*):/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThanOrEqual(8);
    const dark = block(".dark");
    for (const n of names) expect(dark).toContain(`${n}:`);
  });
});
