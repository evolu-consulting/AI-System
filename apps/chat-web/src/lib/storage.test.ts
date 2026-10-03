// C1 FE · localStorage an toàn: accessor ném lỗi (chế độ riêng tư) không làm vỡ trang.
import { describe, expect, test } from "bun:test";
import { DRAFT_KEY_PREFIX, readLocal, removeLocalByPrefix, writeLocal } from "./storage";

const memory = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
};
const throwing = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceeded");
  },
  removeItem: () => {},
};

describe("storage", () => {
  test("đọc lại giá trị đã ghi", () => {
    const s = memory();
    writeLocal("k", "v", s);
    expect(readLocal("k", s)).toBe("v");
  });
  test("accessor ném lỗi hoặc không có storage → null, không ném", () => {
    expect(readLocal("k", throwing)).toBeNull();
    expect(() => writeLocal("k", "v", throwing)).not.toThrow();
    expect(readLocal("k", null)).toBeNull();
  });
});

describe("review C1 #2 · removeLocalByPrefix", () => {
  test("xoá đúng nhóm tiền tố, accessor ném lỗi không vỡ", () => {
    const m = new Map([
      ["chat:draft:u1:new:main", "a"],
      ["chat:draft:u2:c:f", "b"],
      ["chat:theme", "dark"],
    ]);
    const s = {
      get length() {
        return m.size;
      },
      key: (i: number) => [...m.keys()][i] ?? null,
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
    removeLocalByPrefix(DRAFT_KEY_PREFIX, s);
    expect([...m.keys()]).toEqual(["chat:theme"]);
    expect(() =>
      removeLocalByPrefix(DRAFT_KEY_PREFIX, { ...throwing, length: 1, key: () => null }),
    ).not.toThrow();
    expect(() => removeLocalByPrefix(DRAFT_KEY_PREFIX, null)).not.toThrow();
  });
});
