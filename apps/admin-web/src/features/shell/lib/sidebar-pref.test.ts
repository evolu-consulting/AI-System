// CR-121 f11 · nhớ trạng thái thanh bên theo lần bấm gần nhất; kho lỗi ⇒ mở.
import { describe, expect, it } from "bun:test";
import { readCollapsed, SIDEBAR_KEY, writeCollapsed } from "./sidebar-pref";

const mem = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    m,
  };
};
const broken = {
  getItem: (): string | null => {
    throw new Error("blocked");
  },
  setItem: (): void => {
    throw new Error("quota");
  },
};

describe("CR-121 f11 · sidebar-pref", () => {
  it("mặc định mở; nhớ lần bấm gần nhất (thu gọn rồi mở lại)", () => {
    const s = mem();
    expect(readCollapsed(s)).toBe(false);
    writeCollapsed(true, s);
    expect(s.m.get(SIDEBAR_KEY)).toBe("1");
    expect(readCollapsed(s)).toBe(true);
    writeCollapsed(false, s);
    expect(readCollapsed(s)).toBe(false);
  });
  it("kho lỗi/không có ⇒ mở, không ném lỗi", () => {
    expect(readCollapsed(broken)).toBe(false);
    expect(readCollapsed(null)).toBe(false);
    expect(() => writeCollapsed(true, broken)).not.toThrow();
    expect(() => writeCollapsed(true, null)).not.toThrow();
  });
});
