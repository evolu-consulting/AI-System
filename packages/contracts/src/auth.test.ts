import { describe, expect, test } from "bun:test";
import {
  ChangePasswordRequestSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  LogoutRequestSchema,
  MeSchema,
  MeUpdateRequestSchema,
  REFRESH_COOKIE,
  RefreshRequestSchema,
  RefreshResponseSchema,
  TokenGrantSchema,
  X_CLIENT_EXTENSION,
  X_CLIENT_HEADER,
} from "./index";
import { me } from "./test-fixtures";

const grant = {
  status: "authenticated",
  access_token: "eyJ.a.b",
  token_type: "Bearer",
  expires_in: 900,
  user: me,
} as const;
const pwc = { status: "password_change_required", change_token: "eyJ.c.d", expires_in: 300 };

describe("ADM-FR-01 · LoginRequestSchema", () => {
  test("trim + lowercase tenant_key/username, mật khẩu giữ nguyên", () => {
    const r = LoginRequestSchema.parse({ tenant_key: " ACME ", username: "An ", password: " p " });
    expect(r).toEqual({ tenant_key: "acme", username: "an", password: " p " });
  });

  test.each([
    ["thiếu tenant_key", { username: "an", password: "p" }],
    ["thiếu username", { tenant_key: "acme", password: "p" }],
    ["thiếu password", { tenant_key: "acme", username: "an" }],
    ["password rỗng", { tenant_key: "acme", username: "an", password: "" }],
    ["password 129", { tenant_key: "acme", username: "an", password: "a".repeat(129) }],
    ["username 65", { tenant_key: "acme", username: "a".repeat(65), password: "p" }],
    ["tenant_key chỉ khoảng trắng", { tenant_key: "  ", username: "an", password: "p" }],
    ["trường lạ", { tenant_key: "acme", username: "an", password: "p", otp: "1" }],
  ])("từ chối: %s", (_n, input) => {
    expect(LoginRequestSchema.safeParse(input).success).toBe(false);
  });
});

describe("ADM-FR-01 · TokenGrant / LoginResponse", () => {
  test("TokenGrant có user: Me; refresh_token tuỳ chọn (extension)", () => {
    expect(TokenGrantSchema.parse(grant)).toEqual(grant);
    expect(TokenGrantSchema.safeParse({ ...grant, refresh_token: "r".repeat(43) }).success).toBe(
      true,
    );
    expect(TokenGrantSchema.safeParse({ ...grant, expires_in: 3600 }).success).toBe(false);
    expect(TokenGrantSchema.safeParse({ ...grant, token_type: "bearer" }).success).toBe(false);
    const { user: _u, ...noUser } = grant;
    expect(TokenGrantSchema.safeParse(noUser).success).toBe(false);
    expect(RefreshResponseSchema).toBe(TokenGrantSchema);
  });

  test("LoginResponse phân biệt theo status", () => {
    expect(LoginResponseSchema.parse(grant).status).toBe("authenticated");
    expect(LoginResponseSchema.parse(pwc).status).toBe("password_change_required");
    expect(LoginResponseSchema.safeParse({ ...pwc, access_token: "x" }).success).toBe(false);
    expect(LoginResponseSchema.safeParse({ ...pwc, expires_in: 900 }).success).toBe(false);
    expect(LoginResponseSchema.safeParse({ ...grant, status: "ok" }).success).toBe(false);
  });
});

describe("ADM-FR-02 · refresh / logout", () => {
  test("RefreshRequest: refresh_token 1–200, strict", () => {
    expect(RefreshRequestSchema.safeParse({ refresh_token: "r" }).success).toBe(true);
    expect(RefreshRequestSchema.safeParse({ refresh_token: "" }).success).toBe(false);
    expect(RefreshRequestSchema.safeParse({ refresh_token: "r".repeat(201) }).success).toBe(false);
    expect(RefreshRequestSchema.safeParse({}).success).toBe(false);
  });

  test("LogoutRequest: body rỗng hoặc refresh_token", () => {
    expect(LogoutRequestSchema.safeParse({}).success).toBe(true);
    expect(LogoutRequestSchema.safeParse({ refresh_token: "r" }).success).toBe(true);
    expect(LogoutRequestSchema.safeParse({ token: "r" }).success).toBe(false);
  });

  test("hằng header/cookie", () => {
    expect([X_CLIENT_HEADER, X_CLIENT_EXTENSION, REFRESH_COOKIE]).toEqual([
      "X-Client",
      "extension",
      "ai_rt",
    ]);
  });
});

describe("ADM-FR-06 · ChangePasswordRequestSchema", () => {
  const np = "New-Passw0rd-9";
  test("nhận đúng một trong hai dạng", () => {
    expect(
      ChangePasswordRequestSchema.safeParse({ change_token: "t", new_password: np }).success,
    ).toBe(true);
    expect(
      ChangePasswordRequestSchema.safeParse({ current_password: "old", new_password: np }).success,
    ).toBe(true);
  });

  test.each([
    ["cả hai dạng", { change_token: "t", current_password: "old", new_password: np }],
    ["không dạng nào", { new_password: np }],
    ["mật khẩu mới 9", { change_token: "t", new_password: "a".repeat(9) }],
    ["mật khẩu mới 129", { current_password: "old", new_password: "a".repeat(129) }],
    ["current rỗng", { current_password: "", new_password: np }],
    ["trường lạ", { change_token: "t", new_password: np, x: 1 }],
  ])("từ chối: %s", (_n, input) => {
    expect(ChangePasswordRequestSchema.safeParse(input).success).toBe(false);
  });
});

describe("ADM-FR-01 · Me", () => {
  test("MeSchema: must_change_password luôn false, email null được", () => {
    expect(MeSchema.parse(me)).toEqual(me);
    expect(MeSchema.safeParse({ ...me, email: null }).success).toBe(true);
    expect(MeSchema.safeParse({ ...me, must_change_password: true }).success).toBe(false);
    expect(MeSchema.safeParse({ ...me, role: "owner" }).success).toBe(false);
  });

  test("MeUpdateRequest chỉ nhận locale", () => {
    expect(MeUpdateRequestSchema.parse({ locale: "en" })).toEqual({ locale: "en" });
    expect(MeUpdateRequestSchema.safeParse({ locale: "fr" }).success).toBe(false);
    expect(MeUpdateRequestSchema.safeParse({}).success).toBe(false);
    expect(MeUpdateRequestSchema.safeParse({ locale: "vi", role: "member" }).success).toBe(false);
  });
});
