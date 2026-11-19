// CR-190 · nhớ mở/thu nhóm trên máy (localStorage), mặc định theo chưa đọc, dữ liệu hỏng / không truy cập được ⇒ không vỡ.
import { describe, expect, it } from "bun:test";
import { isOpen, readOpen, setOpen, writeOpen } from "./collapse";

const mem = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
};

describe("CR-190 · mặc định mở/thu theo chưa đọc", () => {
  it("chưa chọn: có chưa đọc ⇒ mở, không ⇒ thu", () => {
    expect(isOpen({}, "internal", 2)).toBe(true);
    expect(isOpen({}, "internal", 0)).toBe(false);
  });
  it("đã chọn thì lựa chọn thắng mặc định (thu nhóm có chưa đọc, mở nhóm không có)", () => {
    expect(isOpen({ internal: false }, "internal", 5)).toBe(false);
    expect(isOpen({ chat: true }, "chat", 0)).toBe(true);
  });
});

describe("CR-190 · nhớ trên máy", () => {
  it("ghi rồi đọc lại, setOpen không sửa bản cũ", () => {
    const st = mem();
    const a = setOpen({}, "partner:x", true);
    const b = setOpen(a, "chat", false);
    expect(a).toEqual({ "partner:x": true });
    writeOpen(b, st);
    expect(readOpen(st)).toEqual({ "partner:x": true, chat: false });
  });
  it("dữ liệu hỏng hoặc sai kiểu ⇒ rỗng; giá trị không phải boolean bị bỏ", () => {
    expect(readOpen({ getItem: () => "{hỏng" })).toEqual({});
    expect(readOpen({ getItem: () => "[1,2]" })).toEqual({});
    expect(readOpen({ getItem: () => '{"a":true,"b":"x"}' })).toEqual({ a: true });
  });
  it("không truy cập được (chế độ riêng tư) ⇒ không ném lỗi", () => {
    const bad = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(readOpen(bad)).toEqual({});
    expect(() => writeOpen({ a: true }, bad)).not.toThrow();
  });
});
