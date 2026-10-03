// CHAT-AC-01..04, CHAT-AC-31 · E1–E4 + 401 kênh chat (plan C1 §2.4, §3.4, §3.6; test-plan §4 auth).
// K-A9 (`/__mock/expire-access`, trạng thái toàn cục) đặt CUỐI file, sau đó đăng nhập lại.

import { describe, expect, it } from "bun:test";
import {
  HealthResponseSchema,
  LoginResponseSchema,
  REFRESH_COOKIE,
  RefreshResponseSchema,
  X_CLIENT_EXTENSION,
  X_CLIENT_HEADER,
} from "@ai/contracts/chat";
import {
  call,
  expectAuthError,
  expectChatError,
  expectStatus,
  login,
  okJson,
  refreshCookie,
} from "./_client";
import { isMock, USERS } from "./_env";

const A = USERS.a;
const cookieHeader = (value: string) => ({ Cookie: `${REFRESH_COOKIE}=${value}` });
const refresh = (cookie: string) =>
  call("POST", "/auth/refresh", { headers: cookieHeader(cookie) });

describe("auth · đăng nhập (E1)", () => {
  it("CHAT-AC-01 · login đúng → TokenGrant + cookie ai_rt HttpOnly SameSite=Strict Path=/auth [K-A1]", async () => {
    const res = await call("POST", "/auth/login", { body: A });
    const body = await okJson(res, 200, LoginResponseSchema, "POST /auth/login");
    expect(body.status).toBe("authenticated");
    if (body.status !== "authenticated") return;
    expect(body.user.username).toBe(A.username);
    const c = refreshCookie(res);
    expect(c).not.toBeNull();
    expect(c?.value.length ?? 0).toBeGreaterThan(0);
    expect(c?.line ?? "").toMatch(/;\s*HttpOnly/i);
    expect(c?.line ?? "").toMatch(/;\s*SameSite=Strict/i);
    expect(c?.line ?? "").toMatch(/;\s*Path=\/auth(;|$)/i);
  });

  it("CHAT-AC-02 · sai mật khẩu / tenant lạ / user lạ → cùng 401 INVALID_CREDENTIALS, không Set-Cookie [K-A2]", async () => {
    const bodies = [
      { ...A, password: "sai-mat-khau-1" },
      { ...A, tenant_key: "khong-co-tenant" },
      { ...A, username: "khong-co-user" },
    ];
    const seen: { code: string; message: string }[] = [];
    for (const body of bodies) {
      const res = await call("POST", "/auth/login", { body });
      expect(refreshCookie(res)).toBeNull();
      seen.push(await expectAuthError(res, "INVALID_CREDENTIALS", `login ${JSON.stringify(body)}`));
    }
    expect(seen[1]).toEqual(seen[0] as { code: string; message: string });
    expect(seen[2]).toEqual(seen[0] as { code: string; message: string });
  });

  it("CHAT-AC-02 · body thiếu password · thừa trường → 400 VALIDATION_ERROR [K-A3]", async () => {
    const missing = { tenant_key: A.tenant_key, username: A.username };
    await expectAuthError(
      await call("POST", "/auth/login", { body: missing }),
      "VALIDATION_ERROR",
      "thiếu password",
    );
    const extra = { ...A, la: 1 };
    await expectAuthError(
      await call("POST", "/auth/login", { body: extra }),
      "VALIDATION_ERROR",
      "thừa trường",
    );
  });

  it("CHAT-AC-02 · user bị khoá → 403 ACCOUNT_LOCKED [K-A4]", async () => {
    const res = await call("POST", "/auth/login", { body: USERS.locked });
    await expectAuthError(res, "ACCOUNT_LOCKED", "login user khoá");
  });
});

describe("auth · refresh, logout, health (E2–E4)", () => {
  it("CHAT-AC-03 · refresh xoay cookie; dùng lại cookie cũ → 401 REFRESH_SUPERSEDED [K-A5]", async () => {
    const s = await login(A);
    expect(s.cookie.length).toBeGreaterThan(0);
    const r1 = await refresh(s.cookie);
    const grant = await okJson(r1, 200, RefreshResponseSchema, "POST /auth/refresh");
    expect(grant.access_token.length).toBeGreaterThan(0);
    const rotated = refreshCookie(r1);
    expect(rotated).not.toBeNull();
    expect(rotated?.value).not.toBe(s.cookie);
    await expectAuthError(await refresh(s.cookie), "REFRESH_SUPERSEDED", "refresh cookie cũ");
  });

  it("CHAT-AC-03 · refresh cookie rác → 401 INVALID_REFRESH_TOKEN [K-A5]", async () => {
    await expectAuthError(
      await refresh("rac-khong-ton-tai"),
      "INVALID_REFRESH_TOKEN",
      "refresh cookie rác",
    );
  });

  it("CHAT-AC-03 · refresh kiểu extension (X-Client + body refresh_token) → 200 [K-A5]", async () => {
    const s = await login(A);
    const res = await call("POST", "/auth/refresh", {
      headers: { [X_CLIENT_HEADER]: X_CLIENT_EXTENSION },
      body: { refresh_token: s.cookie },
    });
    await okJson(res, 200, RefreshResponseSchema, "POST /auth/refresh (extension)");
  });

  it("CHAT-AC-31 · GET /health không token → 200 HealthResponse [K-A6]", async () => {
    await okJson(await call("GET", "/health"), 200, HealthResponseSchema, "GET /health");
  });

  it("CHAT-AC-04 · logout 204 → refresh cùng cookie 401 → logout lần 2 vẫn 204 [K-A7]", async () => {
    const s = await login(A);
    const logout = () =>
      call("POST", "/auth/logout", { token: s.access, headers: cookieHeader(s.cookie), body: {} });
    await expectStatus(await logout(), 204, "POST /auth/logout");
    const after = await refresh(s.cookie);
    await expectStatus(after, 401, "refresh sau logout");
    await expectStatus(await logout(), 204, "POST /auth/logout lần 2");
  });
});

describe("auth · 401 AUTH_EXPIRED ở endpoint Hub", () => {
  it("CHAT-AC-03 · E5 không Authorization → 401 AUTH_EXPIRED [K-A8]", async () => {
    await expectChatError(await call("GET", "/conversations"), "AUTH_EXPIRED", "E5 không token");
  });

  it("CHAT-AC-31 · E5 Bearer rác → 401 AUTH_EXPIRED [K-A8]", async () => {
    await expectChatError(
      await call("GET", "/conversations", { token: "rac" }),
      "AUTH_EXPIRED",
      "E5 token rác",
    );
  });

  it("CHAT-AC-31 · E5 với token hợp lệ → 200 (đối chứng cho K-A8)", async () => {
    const s = await login(A);
    const res = await call("GET", "/conversations", { token: s.access });
    await expectStatus(res, 200, "E5 token hợp lệ");
  });
});

// Chỉ mock, CUỐI file: thu hồi mọi access token cấp trước mốc này.
describe.if(isMock)("auth · hết hạn access (chỉ mock)", () => {
  it("CHAT-AC-03 · expire-access → E5 401 → refresh → E5 token mới 200 ngay [K-A9]", async () => {
    const s = await login(A);
    await expectStatus(
      await call("POST", "/__mock/expire-access"),
      204,
      "POST /__mock/expire-access",
    );
    await expectChatError(
      await call("GET", "/conversations", { token: s.access }),
      "AUTH_EXPIRED",
      "E5 token cũ",
    );
    const grant = await okJson(
      await refresh(s.cookie),
      200,
      RefreshResponseSchema,
      "refresh sau expire",
    );
    const res = await call("GET", "/conversations", { token: grant.access_token });
    await expectStatus(res, 200, "E5 token mới");
  });
});
