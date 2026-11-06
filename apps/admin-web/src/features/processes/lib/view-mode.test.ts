// CR-121 c11 · Q11 · chế độ xem quy trình mặc định canvas, nhớ theo trình duyệt, lỗi ⇒ canvas.
import { describe, expect, it } from "bun:test";
import { DEFAULT_VIEW_MODE, readViewMode, VIEW_MODE_KEY, writeViewMode } from "./view-mode";

const memory = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
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

describe("CR-121 c11 · view-mode (Q11)", () => {
  it("mặc định canvas khi chưa lưu, không có kho, hoặc giá trị lạ", () => {
    expect(DEFAULT_VIEW_MODE).toBe("canvas");
    expect(readViewMode(memory())).toBe("canvas");
    expect(readViewMode(null)).toBe("canvas");
    expect(readViewMode(memory({ [VIEW_MODE_KEY]: "grid" }))).toBe("canvas");
  });

  it("nhớ lựa chọn danh sách rồi đọc lại; chọn lại canvas ghi đè", () => {
    const s = memory();
    writeViewMode("list", s);
    expect(s.m.get("processView")).toBe("list");
    expect(readViewMode(s)).toBe("list");
    writeViewMode("canvas", s);
    expect(readViewMode(s)).toBe("canvas");
  });

  it("lỗi đọc/ghi lưu trữ ⇒ canvas, không ném lỗi", () => {
    expect(readViewMode(broken)).toBe("canvas");
    expect(() => writeViewMode("list", broken)).not.toThrow();
    expect(() => writeViewMode("list", null)).not.toThrow();
  });
});
