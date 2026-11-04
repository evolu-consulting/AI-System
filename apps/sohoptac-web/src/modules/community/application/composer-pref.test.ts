// CR-118 · COM-FR-27 · trạng thái thu gọn của ô đăng bản tin: parse chịu lỗi, đọc/ghi khi storage bị chặn.
import { afterEach, describe, expect, it } from "bun:test";
import { loadComposerOpen, parseComposerOpen, saveComposerOpen } from "./composer-pref";

const g = globalThis as { localStorage?: unknown };
afterEach(() => {
  g.localStorage = undefined;
});

describe("composer-pref", () => {
  it("parse: 1 mở, 0 thu gọn, khác là null", () => {
    expect(parseComposerOpen("1")).toBe(true);
    expect(parseComposerOpen("0")).toBe(false);
    expect(parseComposerOpen(null)).toBeNull();
    expect(parseComposerOpen("x")).toBeNull();
  });
  it("lưu và đọc theo người dùng", () => {
    const m = new Map<string, string>();
    g.localStorage = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => m.set(k, v),
    };
    saveComposerOpen("u1", true);
    saveComposerOpen("u2", false);
    expect(loadComposerOpen("u1")).toBe(true);
    expect(loadComposerOpen("u2")).toBe(false);
    expect(loadComposerOpen("u3")).toBeNull();
  });
  it("storage bị chặn thì không ném lỗi", () => {
    g.localStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadComposerOpen("u1")).toBeNull();
    expect(() => saveComposerOpen("u1", true)).not.toThrow();
  });
});
