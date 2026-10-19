// ADM-FR-02 · CR-053 · N1 PK-FR-10: `X-App: contracts` (contracts-web) ⇒ cookie refresh riêng `ai_rt_contracts`;
// app khác giữ nguyên tên cookie; phân biệt hoa thường.
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { readRefreshCookie, setRefreshCookie } from "./cookie";
import { webApp } from "./http";

const app = () => {
  const a = new Hono();
  a.get("/app", (c) => c.text(webApp(c) ?? "none"));
  a.get("/set", (c) => {
    setRefreshCookie(c, "tok", false, webApp(c));
    return c.body(null, 204);
  });
  a.get("/read", (c) => c.text(readRefreshCookie(c, webApp(c)) ?? "none"));
  return a;
};
const req = (path: string, h: Record<string, string>) => app().request(path, { headers: h });

describe("CR-053 · X-App contracts", () => {
  test("ADM-FR-02 · `contracts` được nhận; `Contracts`/`contract` thì không", async () => {
    expect(await (await req("/app", { "X-App": "contracts" })).text()).toBe("contracts");
    for (const v of ["Contracts", "contract", "contracts-web"]) {
      expect(await (await req("/app", { "X-App": v })).text()).toBe("none");
    }
  });

  test("ADM-FR-02 · set/đọc theo app contracts chỉ dùng ai_rt_contracts", async () => {
    const set = (await req("/set", { "X-App": "contracts" })).headers.get("set-cookie") ?? "";
    expect(set).toMatch(/^ai_rt_contracts=tok;/);
    for (const p of [/HttpOnly/, /SameSite=Strict/, /Path=\/auth/]) expect(set).toMatch(p);
    const read = (cookie: string) => req("/read", { "X-App": "contracts", cookie });
    expect(await (await read("ai_rt=a; ai_rt_chat=b")).text()).toBe("none");
    expect(await (await read("ai_rt_chat=b; ai_rt_contracts=c")).text()).toBe("c");
  });

  test("ADM-FR-02 · app cũ giữ tên cookie (không đổi hành vi)", async () => {
    for (const a of ["admin", "chat", "studio"]) {
      const set = (await req("/set", { "X-App": a })).headers.get("set-cookie") ?? "";
      expect(set).toMatch(new RegExp(`^ai_rt_${a}=tok;`));
    }
    expect((await app().request("/set")).headers.get("set-cookie")).toMatch(/^ai_rt=tok;/);
  });
});
