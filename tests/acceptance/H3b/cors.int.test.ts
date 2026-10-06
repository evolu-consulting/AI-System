// ADM-FR-37 · HUB-FR-78 · H3b-R23 · HUB-H3b-AC-12 · test-plan-cases H3b §2.8 A110–A113: preflight CORS từ admin-web
// (`http://localhost:3000`) khi `corsOrigins` có nó; origin lạ / mặc định (chỉ chat-web) không được mở, không bao giờ `*`.
// App dựng bằng `createApp(cfg)` không DB (preflight không chạm DB — G9). Xanh trước code chấp nhận (P13: không đổi code).
import { describe, expect, it } from "bun:test";
import { createApp } from "../../../apps/hub-api/src/app";

const CHAT = "http://localhost:3100";
const ADMIN = "http://localhost:3000";
type Pre = { status: number; acao: string | null; methods: string };

async function preflight(
  origins: string[],
  path: string,
  origin: string,
  method: string,
): Promise<Pre> {
  const app = createApp({ version: "0.0.0-test", corsOrigins: origins });
  const res = await app.request(path, {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": method,
      "access-control-request-headers": "authorization, content-type",
    },
  });
  return {
    status: res.status,
    acao: res.headers.get("access-control-allow-origin"),
    methods: res.headers.get("access-control-allow-methods") ?? "",
  };
}
const ok = (p: Pre) => p.status >= 200 && p.status < 300;

describe("CORS admin-web [ADM-FR-37 · H3b-R23 · HUB-H3b-AC-12]", () => {
  it("ADM-FR-37 · A110 · corsOrigins [:3100, :3000]; OPTIONS /agent-grants Origin :3000, POST, authorization+content-type ⇒ 2xx, ACAO = :3000 [H3b-R23]", async () => {
    const p = await preflight([CHAT, ADMIN], "/agent-grants", ADMIN, "POST");
    expect(ok(p)).toBe(true);
    expect(p.acao).toBe(ADMIN);
  });

  it("ADM-FR-37 · A111 · như trên với DELETE /agent-grants · GET /runs/x/trace ⇒ cho phép [H3b-R23]", async () => {
    const d = await preflight([CHAT, ADMIN], "/agent-grants", ADMIN, "DELETE");
    expect({ ok: ok(d), acao: d.acao }).toEqual({ ok: true, acao: ADMIN });
    expect(d.methods.toUpperCase()).toContain("DELETE");
    const g = await preflight([CHAT, ADMIN], "/runs/x/trace", ADMIN, "GET");
    expect({ ok: ok(g), acao: g.acao }).toEqual({ ok: true, acao: ADMIN });
  });

  it("ADM-FR-37 · A112 · Origin http://evil.example ⇒ không Access-Control-Allow-Origin của evil, không * [H3b-R23]", async () => {
    const p = await preflight([CHAT, ADMIN], "/agent-grants", "http://evil.example", "POST");
    expect(p.acao === "http://evil.example" || p.acao === "*").toBe(false);
  });

  it("ADM-FR-37 · A113 · corsOrigins [:3100] (mặc định) ⇒ :3000 không có ACAO; không bao giờ * [H3b-R23 · không mở ngầm]", async () => {
    for (const [path, m] of [
      ["/agent-grants", "POST"],
      ["/agent-grants", "DELETE"],
      ["/runs/x/trace", "GET"],
    ] as const) {
      const p = await preflight([CHAT], path, ADMIN, m);
      expect({ path, m, acao: p.acao === ADMIN || p.acao === "*" }).toEqual({
        path,
        m,
        acao: false,
      });
      const c = await preflight([CHAT], path, CHAT, m);
      expect(c.acao).not.toBe("*");
    }
  });
});
