import { describe, expect, test } from "bun:test";
import { LoginResponseSchema, REFRESH_COOKIE, TokenGrantSchema } from "@ai/contracts/chat";
import { HUB_EFFECTIVE_OK } from "../fixtures";
import { createHubMock } from "../hub";

const app = createHubMock({ timeoutMs: 50 });
const LAN = { tenant_key: "ACME", username: "Lan", password: "dev-password-1" };
const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});
const cookieOf = (res: Response) =>
  /ai_rt=([^;]*)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? null;
const bearer = (t: string) => ({ headers: { Authorization: `Bearer ${t}` } });

async function login(headers: Record<string, string> = {}) {
  const res = await app.request("/auth/login", json(LAN, headers));
  expect(res.status).toBe(200);
  return { res, grant: TokenGrantSchema.parse(await res.json()) };
}

describe("CHAT-AC-01..04 · /auth/* mock", () => {
  test("login chuẩn hoá chữ thường, user = Me của lan, cookie ai_rt", async () => {
    const { res, grant } = await login();
    expect(LoginResponseSchema.parse(grant).status).toBe("authenticated");
    expect(grant.user).toMatchObject({ username: "lan", role: "member", tenant: { key: "acme" } });
    expect(grant.refresh_token).toBeUndefined();
    expect(res.headers.get("set-cookie")).toContain("Max-Age=2592000");
  });

  test("extension: refresh_token trong body, không cookie; refresh bằng body", async () => {
    const ext = { "X-Client": "extension" };
    const { res, grant } = await login(ext);
    expect(cookieOf(res)).toBeNull();
    const r = await app.request("/auth/refresh", json({ refresh_token: grant.refresh_token }, ext));
    expect(TokenGrantSchema.parse(await r.json()).refresh_token).not.toBe(grant.refresh_token);
    const bad = await app.request("/auth/refresh", json({}, ext));
    expect(bad.status).toBe(400);
  });

  test("JSON hỏng → 400 VALIDATION_ERROR invalid_json", async () => {
    const res = await app.request("/auth/login", { method: "POST", body: "{" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { details: { issues: [{ code: "invalid_json" }] } },
    });
  });

  test("refresh web không cookie → 401 INVALID_REFRESH_TOKEN, xoá cookie", async () => {
    const res = await app.request("/auth/refresh", { method: "POST" });
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toContain(`${REFRESH_COOKIE}=;`);
  });

  test("logout thu hồi luôn access của phiên", async () => {
    const { res, grant } = await login();
    const out = await app.request("/auth/logout", {
      method: "POST",
      headers: { Cookie: `${REFRESH_COOKIE}=${cookieOf(res)}` },
    });
    expect(out.status).toBe(204);
    expect((await app.request("/conversations", bearer(grant.access_token))).status).toBe(401);
  });
});

describe("CHAT-AC-31 · thứ tự route chat ↔ kịch bản M0", () => {
  test("route chat chưa có + JWT hợp lệ → 404 M0; không token → 401 AUTH_EXPIRED", async () => {
    const { grant } = await login();
    const t = grant.access_token;
    expect((await app.request("/conversations/abc", bearer(t))).status).toBe(404);
    const r401 = await app.request("/runs/abc");
    expect(await r401.json()).toMatchObject({ error: { code: "AUTH_EXPIRED" } });
  });

  test("route M0 không đổi: mock-ok vẫn chạy, JWT chat không thay được mock-ok sai kịch bản", async () => {
    const U = "00000000-0000-7000-8000-0000000000c1";
    const ok = await app.request(`/agent-grants/effective/${U}`, bearer("mock-ok"));
    expect(await ok.json()).toEqual(HUB_EFFECTIVE_OK);
    expect((await app.request("/internal/test-run", { method: "POST" })).status).toBe(401);
  });

  test("/__mock/ping 204; /health theo healthVersion", async () => {
    expect((await app.request("/__mock/ping")).status).toBe(204);
    const v = createHubMock({ timeoutMs: 0, healthVersion: "0.0.0-mock" });
    expect(await (await v.request("/health")).json()).toEqual({
      status: "ok",
      version: "0.0.0-mock",
    });
  });
});
