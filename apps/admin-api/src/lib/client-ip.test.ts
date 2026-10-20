// L1 (TECH-DEBT #224) · IP client: chỉ tin X-Forwarded-For theo số proxy cấu hình; phần client tự ghi không né được giới hạn.
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { clientIp, forwardedIp } from "./client-ip";

describe("L1 · forwardedIp", () => {
  test("1 proxy: lấy phần tử cuối (proxy nối), bỏ phần client tự ghi bên trái", () => {
    expect(forwardedIp("6.6.6.6, 203.0.113.7", 1)).toBe("203.0.113.7");
    expect(forwardedIp("203.0.113.7", 1)).toBe("203.0.113.7");
  });

  test("2 proxy: phần tử thứ 2 từ cuối; L1c (A-6) ít phần tử hơn số hop ⇒ null (không tin phần client ghi)", () => {
    expect(forwardedIp("1.1.1.1, 203.0.113.7, 10.0.0.2", 2)).toBe("203.0.113.7");
    expect(forwardedIp("203.0.113.7, 10.0.0.2", 2)).toBe("203.0.113.7");
    expect(forwardedIp("203.0.113.7", 2)).toBeNull();
    expect(forwardedIp("6.6.6.6", 3)).toBeNull();
  });

  test("không có header / hops = 0 / rỗng ⇒ null", () => {
    expect(forwardedIp(undefined, 1)).toBeNull();
    expect(forwardedIp("1.2.3.4", 0)).toBeNull();
    expect(forwardedIp(" , ", 1)).toBeNull();
  });
});

describe("L1 · clientIp", () => {
  const app = (hops: number) => {
    const r = new Hono();
    r.get("/", (c) => c.text(String(clientIp(c, hops))));
    return r;
  };
  const xff = { "x-forwarded-for": "6.6.6.6, 203.0.113.7" };

  test("hops = 0 ⇒ bỏ qua XFF (không có socket trong test ⇒ null)", async () => {
    expect(await (await app(0).request("/", { headers: xff })).text()).toBe("null");
  });

  test("hops = 1 ⇒ IP từ XFF", async () => {
    expect(await (await app(1).request("/", { headers: xff })).text()).toBe("203.0.113.7");
  });

  test("hops = 0 ⇒ địa chỉ socket qua env.requestIP của Bun", async () => {
    const env = { requestIP: () => ({ address: "198.51.100.9" }) };
    expect(await (await app(0).request("/", {}, env)).text()).toBe("198.51.100.9");
  });
});
