// ADM-FR-02, ADM-NFR-01 · thuộc tính cookie ai_rt.
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from "./cookie";

const app = (secure: boolean) => {
  const a = new Hono();
  a.get("/set", (c) => {
    setRefreshCookie(c, "tok", secure);
    return c.body(null, 204);
  });
  a.get("/clear", (c) => {
    clearRefreshCookie(c, secure);
    return c.body(null, 204);
  });
  a.get("/read", (c) => c.text(readRefreshCookie(c) ?? "none"));
  return a;
};
const setCookieOf = async (secure: boolean, path: string) =>
  (await app(secure).request(path)).headers.get("set-cookie") ?? "";

describe("ADM-FR-02 · cookie", () => {
  test("ADM-FR-02 · set: HttpOnly, SameSite=Strict, Path=/auth, Max-Age 30 ngày; Secure chỉ khi bật", async () => {
    const dev = await setCookieOf(false, "/set");
    expect(dev).toMatch(/^ai_rt=tok;/);
    for (const p of [/HttpOnly/, /SameSite=Strict/, /Path=\/auth/, /Max-Age=2592000/]) {
      expect(dev).toMatch(p);
    }
    expect(dev).not.toMatch(/Secure/);
    expect(await setCookieOf(true, "/set")).toMatch(/Secure/);
  });

  test("ADM-FR-03 · clear: giá trị rỗng, Max-Age=0, Path=/auth; read: rỗng → không có", async () => {
    const c = await setCookieOf(false, "/clear");
    expect(c).toMatch(/^ai_rt=;/);
    expect(c).toMatch(/Max-Age=0/);
    expect(c).toMatch(/Path=\/auth/);
    const read = (cookie: string) => app(false).request("/read", { headers: { cookie } });
    expect(await (await read("ai_rt=abc")).text()).toBe("abc");
    expect(await (await read("ai_rt=")).text()).toBe("none");
  });
});
