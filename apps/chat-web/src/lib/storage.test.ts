// C1 FE · localStorage an toàn: accessor ném lỗi (chế độ riêng tư) không làm vỡ trang.
import { describe, expect, test } from "bun:test";
import { readLocal, writeLocal } from "./storage";

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
