// CR-182 · soát #8 — khoá sessionStorage của ảnh chữ ký nhanh dùng băm của token, không chứa token thô.
import { afterEach, describe, expect, test } from "bun:test";
import { imageKey, recallImage, rememberImage } from "./quick-image";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde";
const store = new Map<string, string>();
// biome-ignore lint/suspicious/noExplicitAny: giả sessionStorage trong bun test
(globalThis as any).sessionStorage = {
  setItem: (k: string, v: string) => void store.set(k, v),
  getItem: (k: string) => store.get(k) ?? null,
};
afterEach(() => store.clear());

describe("khoá ảnh chữ ký nhanh", () => {
  test("SHA-256 hex, ổn định, không chứa token", async () => {
    const k = await imageKey(TOKEN);
    expect(k).toMatch(/^psign:img:[0-9a-f]{64}$/);
    expect(k).toBe(await imageKey(TOKEN));
    expect(k).not.toContain(TOKEN);
    expect(k).not.toBe(await imageKey(`${TOKEN}x`));
  });
  test("nhớ + gọi lại; sessionStorage không có khoá nào chứa token", async () => {
    await rememberImage(TOKEN, "data:image/png;base64,AAA");
    expect(await recallImage(TOKEN)).toBe("data:image/png;base64,AAA");
    expect(await recallImage("khac")).toBeNull();
    for (const k of store.keys()) expect(k).not.toContain(TOKEN);
  });
});
