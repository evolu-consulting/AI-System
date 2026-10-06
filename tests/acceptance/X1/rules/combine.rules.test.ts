// X1-AC19 · luật thuần `combine:dev` (plan-stack.md "Kiểu", plan §3): `START_ORDER` 6 ProcName, `buildCombineEnv` (env §3,
// token chung chỉ tới admin-api/hub-api, không lọt sang web), `stopOrder` (ngược thứ tự bật, chỉ tên đã bật).
// Token giả sinh lúc chạy. Nạp động (P7) ⇒ đỏ "Cannot find module" tới khi ST1 xong.
import { describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { type Loose, loadCombineRules } from "../_modules";

const ORDER = ["admin-api", "hub-api", "dify-mock", "chat-web", "admin-web", "studio-web"];
const ORIGINS = ["http://localhost:3000", "http://localhost:3100", "http://localhost:3200"];
const csv = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .sort();
const BASE = { PATH: "/usr/bin", DATABASE_URL: "postgres://x@localhost:5432/ai_system" };

async function env(opts: Loose = {}): Promise<Record<string, Record<string, string>>> {
  return (await loadCombineRules()).buildCombineEnv(BASE, opts);
}

describe("X1-AC19 · combine.rules", () => {
  it("X1-AC19 · START_ORDER đúng 6 tiến trình theo thứ tự bật", async () => {
    const r = await loadCombineRules();
    expect([...r.START_ORDER]).toEqual(ORDER);
  });

  it("X1-AC19 · buildCombineEnv trả env cho đủ 6 ProcName; token truyền vào dùng chung cho admin-api + hub-api", async () => {
    const tok = randomBytes(36).toString("base64url");
    const e = await env({ token: tok });
    expect(Object.keys(e).sort()).toEqual([...ORDER].sort());
    expect(e["admin-api"]?.HUB_INTERNAL_TOKEN).toBe(tok);
    expect(e["hub-api"]?.HUB_INTERNAL_TOKEN).toBe(tok);
  });

  it("X1-AC19 · vắng token ⇒ sinh 48 ký tự, cùng giá trị cho cả 2 tiến trình; mỗi lần gọi một token mới", async () => {
    const a = await env();
    const t = a["admin-api"]?.HUB_INTERNAL_TOKEN ?? "";
    expect(t).toHaveLength(48);
    expect(a["hub-api"]?.HUB_INTERNAL_TOKEN).toBe(t);
    const b = await env();
    expect(b["admin-api"]?.HUB_INTERNAL_TOKEN).not.toBe(t);
  });

  it("X1-AC19 · HUB_INTERNAL_TOKEN không có trong env của web/dify-mock (plan R2)", async () => {
    const tok = randomBytes(36).toString("base64url");
    const e = await env({ token: tok });
    for (const p of ["dify-mock", "chat-web", "admin-web", "studio-web"]) {
      expect(e[p]?.HUB_INTERNAL_TOKEN).toBeUndefined();
      expect(JSON.stringify(e[p])).not.toContain(tok);
    }
  });

  it("X1-AC19 · env §3: CORS_ORIGINS / HUB_CORS_ORIGINS 3 origin, ADMIN_HUB_URL :4000, web có PUBLIC_* và URL proxy", async () => {
    const e = await env();
    expect(csv(e["admin-api"]?.CORS_ORIGINS)).toEqual(ORIGINS);
    expect(csv(e["hub-api"]?.HUB_CORS_ORIGINS)).toEqual(ORIGINS);
    expect(e["admin-api"]?.ADMIN_HUB_URL).toBe("http://localhost:4000");
    expect(e["chat-web"]).toMatchObject({
      HUB_URL: "http://localhost:4000",
      AUTH_URL: "http://localhost:3001",
    });
    expect(e["admin-web"]).toMatchObject({
      ADMIN_API_URL: "http://localhost:3001",
      PUBLIC_HUB_URL: "http://localhost:4000",
      PUBLIC_STUDIO_URL: "http://localhost:3200/studio/",
      PUBLIC_CHAT_WEB_URL: "http://localhost:3100",
    });
    expect(e["studio-web"]).toMatchObject({
      ADMIN_API_URL: "http://localhost:3001",
      HUB_URL: "http://localhost:4000",
      PUBLIC_ADMIN_WEB_URL: "http://localhost:3000",
      PUBLIC_CHAT_WEB_URL: "http://localhost:3100",
    });
  });

  it("X1-AC19 · stopOrder = ngược thứ tự bật, chỉ gồm tên đã bật", async () => {
    const r = await loadCombineRules();
    expect(r.stopOrder(ORDER)).toEqual([...ORDER].reverse());
    expect(r.stopOrder(["admin-api", "hub-api", "chat-web"])).toEqual([
      "chat-web",
      "hub-api",
      "admin-api",
    ]);
    // mock=false: dify-mock không bật ⇒ không có trong thứ tự dừng
    const noMock = ORDER.filter((p) => p !== "dify-mock");
    expect(r.stopOrder(noMock)).not.toContain("dify-mock");
    expect(r.stopOrder([])).toEqual([]);
  });

  it("X1-AC19 · opts.mock=false vẫn trả env đủ 6 khoá (plan-stack: env vẫn trả)", async () => {
    const e = await env({ mock: false });
    expect(Object.keys(e).sort()).toEqual([...ORDER].sort());
  });
});
