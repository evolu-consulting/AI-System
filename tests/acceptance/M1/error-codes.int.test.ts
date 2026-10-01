// ADM-FR-01, ADM-FR-04, ADM-FR-60 · mọi mã lỗi ↔ API_ERRORS (test-plan A7).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  API_ERRORS,
  type ErrorCode,
  ErrorResponseSchema,
  LastAdminDetailsSchema,
  TempLockedDetailsSchema,
  ValidationErrorDetailsSchema,
  versionConflictDetailsSchema,
} from "@ai/contracts";
import { createDb } from "@ai/db";
import {
  ADMIN_API_URL,
  createEnv,
  type Env,
  expectErr,
  PW,
  type Res,
  TENANT_ID,
  USER_ID,
  wrongLogins,
} from "./_fixtures";

type Scenario = (env: Env) => Promise<Res>;
// 22 mã M1 (không gồm INTERNAL_ERROR); 11 mã M2 do tests/acceptance/M2/error-codes.int.test.ts phụ trách.
const M1_TESTABLE = [
  "VALIDATION_ERROR",
  "TENANT_REQUIRED",
  "ROLE_NOT_ALLOWED",
  "EMAIL_REQUIRED",
  "PASSWORD_UNCHANGED",
  "INVALID_CURRENT_PASSWORD",
  "UNAUTHORIZED",
  "INVALID_CREDENTIALS",
  "INVALID_REFRESH_TOKEN",
  "REFRESH_SUPERSEDED",
  "INVALID_CHANGE_TOKEN",
  "FORBIDDEN",
  "ACCOUNT_LOCKED",
  "SELF_ACTION_FORBIDDEN",
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "KEY_TAKEN",
  "USERNAME_TAKEN",
  "EMAIL_TAKEN",
  "LAST_ADMIN",
  "PLATFORM_TENANT_LOCKED",
  "TEMP_LOCKED",
] as const satisfies readonly ErrorCode[];
type Testable = (typeof M1_TESTABLE)[number];

let env: Env;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await env.reset();
});

const newUser = (username: string, over: Record<string, unknown> = {}) => ({
  username,
  display_name: `User ${username}`,
  role: "member",
  ...over,
});
const newTenant = (key: string) => ({
  key,
  name: key,
  first_admin: { username: "boss", display_name: "Boss", email: "boss@x.test" },
});
const as = async (tenant: string, user: string) => env.token(tenant, user);

const SCENARIOS: Record<Testable, Scenario> = {
  VALIDATION_ERROR: (e) => e.post("/auth/login", { body: {} }),
  TENANT_REQUIRED: async (e) =>
    e.post("/admin/users", { token: await as("platform", "admin"), body: newUser("nam") }),
  ROLE_NOT_ALLOWED: async (e) =>
    e.post("/admin/users", {
      token: await as("acme", "binh"),
      body: newUser("nam", { role: "platform_admin" }),
    }),
  EMAIL_REQUIRED: async (e) =>
    e.post("/admin/users", {
      token: await as("acme", "binh"),
      body: newUser("nam", { role: "tenant_admin" }),
    }),
  PASSWORD_UNCHANGED: async (e) =>
    e.post("/auth/change-password", {
      token: await as("acme", "an"),
      body: { current_password: PW, new_password: PW },
    }),
  INVALID_CURRENT_PASSWORD: async (e) =>
    e.post("/auth/change-password", {
      token: await as("acme", "an"),
      body: { current_password: "Sai-Passw0rd-1", new_password: "New-Passw0rd-9" },
    }),
  UNAUTHORIZED: (e) => e.get("/auth/me"),
  INVALID_CREDENTIALS: (e) => e.login("acme", "an", "Sai-Passw0rd-1"),
  INVALID_REFRESH_TOKEN: (e) => e.post("/auth/refresh"),
  REFRESH_SUPERSEDED: async (e) => {
    const s = await e.session("acme", "an", PW);
    await e.post("/auth/refresh", { cookie: s.cookie });
    return e.post("/auth/refresh", { cookie: s.cookie });
  },
  INVALID_CHANGE_TOKEN: (e) =>
    e.post("/auth/change-password", {
      body: { change_token: "khong.phai.jwt", new_password: "New-Passw0rd-9" },
    }),
  FORBIDDEN: async (e) => e.get("/admin/users", { token: await as("acme", "an") }),
  ACCOUNT_LOCKED: (e) => e.login("acme", "em", PW),
  SELF_ACTION_FORBIDDEN: async (e) =>
    e.post(`/admin/users/${USER_ID.binh}/lock`, { token: await as("acme", "binh") }),
  NOT_FOUND: async (e) =>
    e.get("/admin/tenants/01900000-0000-7000-8000-000000000999", {
      token: await as("platform", "admin"),
    }),
  VERSION_CONFLICT: async (e) =>
    e.patch(`/admin/tenants/${TENANT_ID.acme}`, {
      token: await as("platform", "admin"),
      body: { version: 99, name: "Khac" },
    }),
  KEY_TAKEN: async (e) =>
    e.post("/admin/tenants", { token: await as("platform", "admin"), body: newTenant("acme") }),
  USERNAME_TAKEN: async (e) =>
    e.post("/admin/users", { token: await as("acme", "binh"), body: newUser("an") }),
  EMAIL_TAKEN: async (e) =>
    e.post("/admin/users", {
      token: await as("acme", "binh"),
      body: newUser("nam", { email: "lan@acme.test" }),
    }),
  LAST_ADMIN: async (e) =>
    e.post(`/admin/users/${USER_ID.hoa}/lock`, { token: await as("platform", "admin") }),
  PLATFORM_TENANT_LOCKED: async (e) => {
    const [p] = await e.owner`select id from admin.tenants where key = 'platform'`;
    return e.post(`/admin/tenants/${p?.id}/lock`, { token: await as("platform", "admin") });
  },
  TEMP_LOCKED: async (e) => {
    await wrongLogins(e, "acme", "an", 5);
    return e.login("acme", "an", PW);
  },
};

const covered = new Set<string>();

describe("ADM-FR-01 · mã lỗi ↔ API_ERRORS", () => {
  for (const code of Object.keys(SCENARIOS) as Testable[]) {
    it(`ADM-FR-01 · spec §3 · ${code} → HTTP ${API_ERRORS[code]}, body ErrorResponse, message tiếng Anh, details đúng schema`, async () => {
      const scenario = SCENARIOS[code];
      const res = await scenario(env);
      covered.add(code);
      expectErr(res, code);
      const body = ErrorResponseSchema.parse(res.json);
      expect(body.error.message.length).toBeGreaterThan(0);
      expect(body.error.message).toMatch(/^[\x20-\x7e]+$/);
      const d = body.error.details;
      if (code === "VALIDATION_ERROR") ValidationErrorDetailsSchema.parse(d);
      if (code === "VERSION_CONFLICT") {
        const v = versionConflictDetailsSchema("tenant").parse(d);
        expect(v.updated_at).toBe(v.current.updated_at);
      }
      if (code === "TEMP_LOCKED") TempLockedDetailsSchema.parse(d);
      if (code === "LAST_ADMIN") LastAdminDetailsSchema.parse(d);
    });
  }

  it("ADM-FR-01 · spec §3 · tập mã M1 đã chạy kịch bản == 22 mã M1 (trừ INTERNAL_ERROR)", () => {
    expect([...covered].sort()).toEqual([...M1_TESTABLE].sort());
  });

  it("ADM-FR-01 · spec §3 · INTERNAL_ERROR: db đã đóng → 500, không lộ stack/chuỗi kết nối/password", async () => {
    const db = createDb(ADMIN_API_URL, { max: 1 });
    await db.close();
    const broken = await env.makeCaller("test", db);
    const res = await broken.call("POST", "/auth/login", {
      body: { tenant_key: "acme", username: "an", password: PW },
    });
    expectErr(res, "INTERNAL_ERROR");
    expect(res.text).not.toMatch(/postgres:\/\/|password|stack|\bat\s.+\(/i);
  });
});
