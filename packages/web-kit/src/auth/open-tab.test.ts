import { afterEach, describe, expect, mock, test } from "bun:test";
import { openInNewTab } from "./open-tab";

const g = globalThis as unknown as { window?: unknown };
const orig = g.window;
afterEach(() => {
  g.window = orig;
});

function fakeWindow(tab: unknown) {
  const assign = mock((_u: string) => {});
  const open = mock(() => tab);
  g.window = { open, location: { assign } };
  return { assign, open };
}

describe("openInNewTab", () => {
  test("mở tab ngay lúc bấm rồi gán URL cho tab đó", async () => {
    const tab = { location: { href: "" }, opener: 1, close: mock(() => {}) };
    const { assign, open } = fakeWindow(tab);
    const ok = await openInNewTab(async () => "https://a/x");
    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(tab.location.href).toBe("https://a/x");
    expect(assign).not.toHaveBeenCalled();
    expect(ok).toBe(true);
  });
  test("popup bị chặn (null) ⇒ điều hướng tab hiện tại", async () => {
    const { assign } = fakeWindow(null);
    await openInNewTab(async () => "https://a/x");
    expect(assign).toHaveBeenCalledWith("https://a/x");
  });
  test("không xin được mã ⇒ dùng URL dự phòng; không có ⇒ đóng tab, trả false", async () => {
    const tab = { location: { href: "" }, opener: 1, close: mock(() => {}) };
    fakeWindow(tab);
    expect(await openInNewTab(async () => null, "https://fb")).toBe(true);
    expect(tab.location.href).toBe("https://fb");
    const tab2 = { location: { href: "" }, opener: 1, close: mock(() => {}) };
    fakeWindow(tab2);
    expect(await openInNewTab(async () => null)).toBe(false);
    expect(tab2.close).toHaveBeenCalled();
  });
});
