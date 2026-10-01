// ADM-NFR-01, ADM-BR-05, ADM-FR-05 · xác thực Bearer của admin-api (test-plan A6).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { SignJWT } from "jose";
import {
  createEnv,
  type Env,
  expectErr,
  makeKeys,
  PW,
  type Res,
  signJwt,
  TENANT_ID,
  USER_ID,
} from "./_fixtures";

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

const me = (token?: string): Promise<Res> => env.get("/auth/me", { token });
const access = (over: Partial<Parameters<typeof signJwt>[0]> = {}) =>
  signJwt({
    sub: USER_ID.an,
    aud: "ai-system",
    claims: { tid: TENANT_ID.acme, role: "member" },
    expOffsetS: 900,
    privatePem: env.keys.privatePem,
    ...over,
  });
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

describe("ADM-NFR-01 · token Bearer không hợp lệ → 401 UNAUTHORIZED", () => {
  it("ADM-NFR-01 · M1-R02 · thiếu Bearer / sai dạng (Basic, Bearer rỗng, rác) → 401", async () => {
    expectErr(await me(), "UNAUTHORIZED");
    for (const authorization of ["Basic abc", "Bearer", "Bearer ", "Bearer rac.rac.rac", "abc"]) {
      expectErr(await env.get("/auth/me", { headers: { authorization } }), "UNAUTHORIZED");
    }
  });

  it("ADM-NFR-01 · M1-R02 · sai chữ ký (khoá khác) và hết hạn → 401", async () => {
    expectErr(await me(await access({ privatePem: makeKeys().privatePem })), "UNAUTHORIZED");
    const expired = await access({ iatOffsetS: -1000, expOffsetS: -100 });
    expectErr(await me(expired), "UNAUTHORIZED");
    expect((await me(await access())).status).toBe(200);
  });

  it("ADM-NFR-01 · M1-R05 · sai aud (dùng change_token) và sai iss → 401", async () => {
    expectErr(await me(await access({ aud: "admin:password-change" })), "UNAUTHORIZED");
    expectErr(await me(await access({ iss: "evil" })), "UNAUTHORIZED");
  });

  it("ADM-NFR-01 · M1-R02 · alg HS256 và alg none → 401", async () => {
    const claims = {
      sub: USER_ID.an,
      tid: TENANT_ID.acme,
      role: "member",
      iss: "admin",
      aud: "ai-system",
    };
    const hs = await new SignJWT(claims)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(new TextEncoder().encode("khoa-bi-mat-hs256-dai-hon-32-ky-tu!!"));
    const exp = Math.floor(Date.now() / 1000) + 900;
    const none = `${b64({ alg: "none" })}.${b64({ ...claims, exp })}.`;
    for (const t of [hs, none]) expectErr(await me(t), "UNAUTHORIZED");
  });
});

describe("ADM-FR-05 · middleware đọc lại DB mỗi request", () => {
  it("ADM-FR-05 · M1-R09 · owner đặt active=false → token còn hạn vẫn 401 ngay", async () => {
    const s = await env.session("acme", "an", PW);
    expect((await me(s.token)).status).toBe(200);
    await env.owner`update admin.users set active = false where id = ${USER_ID.an}`;
    expectErr(await me(s.token), "UNAUTHORIZED");
  });

  it("ADM-BR-05 · M1-R12 · owner hạ role binh tenant_admin→member (token vẫn claim tenant_admin) → /admin/users 403", async () => {
    const s = await env.session("acme", "binh", PW);
    expect((await env.get("/admin/users", { token: s.token })).status).toBe(200);
    await env.owner`update admin.users set role = 'member' where id = ${USER_ID.binh}`;
    expectErr(await env.get("/admin/users", { token: s.token }), "FORBIDDEN");
  });

  it("ADM-FR-05 · M1-R10 · owner khoá tenant → token 401; owner xoá user khỏi DB → token 401", async () => {
    const a = await env.session("acme", "an", PW);
    const g = await env.session("globex", "khang", PW);
    await env.owner`update admin.tenants set active = false where id = ${TENANT_ID.acme}`;
    expectErr(await me(a.token), "UNAUTHORIZED");
    await env.owner`delete from admin.users where id = ${USER_ID.khang}`;
    expectErr(await me(g.token), "UNAUTHORIZED");
  });
});

describe("ADM-BR-09 · scope platform chỉ theo role trong DB", () => {
  it("ADM-BR-09 · M1-R13 · token giả claim platform_admin của member → 403 trên /admin/tenants và /admin/users", async () => {
    const forged = await access({ claims: { tid: TENANT_ID.acme, role: "platform_admin" } });
    expectErr(await env.get("/admin/tenants", { token: forged }), "FORBIDDEN");
    expectErr(await env.get("/admin/users", { token: forged }), "FORBIDDEN");
  });

  it("ADM-BR-09 · M1-R13 · token của binh (tenant_admin) claim platform_admin → /admin/tenants 403, /admin/users chỉ thấy tenant acme", async () => {
    const forged = await access({
      sub: USER_ID.binh,
      claims: { tid: TENANT_ID.acme, role: "platform_admin" },
    });
    expectErr(await env.get("/admin/tenants", { token: forged }), "FORBIDDEN");
    const res = await env.get("/admin/users", { token: forged });
    expect(res.status).toBe(200);
    for (const u of res.json.items) expect(u.tenant_id).toBe(TENANT_ID.acme);
    expect(res.json.total).toBe(7);
  });

  it("ADM-NFR-01 · M1-R02 · token claim tid sai tenant (user acme, tid globex) không mở được dữ liệu globex", async () => {
    const t = await access({
      sub: USER_ID.binh,
      claims: { tid: TENANT_ID.globex, role: "tenant_admin" },
    });
    const res = await env.get("/admin/users", { token: t });
    if (res.status === 200) {
      for (const u of res.json.items) expect(u.tenant_id).toBe(TENANT_ID.acme);
    } else {
      expectErr(res, "UNAUTHORIZED");
    }
  });
});
