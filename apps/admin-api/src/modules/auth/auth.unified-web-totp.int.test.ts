// CR-118 · cr118-auth · web gộp workspace-web: bước TOTP với `X-App: contracts` cấp đúng cookie `ai_rt_contracts` (một phiên cho
// SHT + Community). Env M4 (có SECRET_MASTER_KEY, đồng hồ giả) — endpoint có sẵn, không đổi.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { TokenGrantSchema } from "@ai/contracts";
import {
  createM3Env,
  enable2fa,
  login,
  type M3Env,
  nextCode,
  PW,
  verify,
} from "../../../../../tests/acceptance/M4/_cd";

let env: M3Env;
beforeAll(async () => {
  env = await createM3Env();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await env.reset3();
});

const CT = { "X-App": "contracts" };

describe("CR-118 · web gộp: TOTP một phiên X-App contracts", () => {
  it("TOTP: login ⇒ totp_required (chưa cookie) ⇒ verify ⇒ cookie ai_rt_contracts", async () => {
    const e = await enable2fa(env, "acme", "binh", PW);
    const first = await login(env, "acme", "binh", PW, CT);
    expect(first.json.status).toBe("totp_required");
    expect(first.cookies.some((c) => c.startsWith("ai_rt"))).toBe(false);
    const v = await verify(
      env,
      { totp_token: first.json.totp_token, code: nextCode(env, e.secret) },
      CT,
    );
    expect(v.status).toBe(200);
    expect(TokenGrantSchema.parse(v.json).user.username).toBe("binh");
    expect(v.cookies.find((c) => c.startsWith("ai_rt_contracts="))).toMatch(/HttpOnly/i);
    expect(v.cookies.some((c) => /^ai_rt(_chat|_community)?=/.test(c))).toBe(false);
  });
});
