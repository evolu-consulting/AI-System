// prefs-sync · PATCH /auth/me đổi locale/theme của CHÍNH MÌNH; GET /auth/me trả lại; người khác không bị ảnh hưởng; mặc định light.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createEnv, type Env } from "../../../../../tests/acceptance/M1/_fixtures";

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

const me = async (tenant: string, user: string) =>
  (await env.get("/auth/me", { token: await env.token(tenant, user) })).json as {
    locale: string;
    theme: string;
  };

describe("prefs-sync · /auth/me", () => {
  it("mặc định light; PATCH theme+locale của mình, /me trả lại, người khác nguyên; body sai bị từ chối", async () => {
    expect((await me("acme", "an")).theme).toBe("light");
    const token = await env.token("acme", "an");
    const ok = await env.call("PATCH", "/auth/me", {
      token,
      body: { theme: "dark", locale: "en" },
    });
    expect(ok.status).toBe(200);
    expect(await me("acme", "an")).toMatchObject({ theme: "dark", locale: "en" });
    const only = await env.call("PATCH", "/auth/me", { token, body: { theme: "system" } });
    expect(only.status).toBe(200);
    expect(await me("acme", "an")).toMatchObject({ theme: "system", locale: "en" });
    expect((await me("acme", "binh")).theme).toBe("light");
    expect((await me("globex", "hoa")).theme).toBe("light");
    for (const body of [{}, { theme: "blue" }, { theme: "dark", role: "platform_admin" }]) {
      expect((await env.call("PATCH", "/auth/me", { token, body })).status).toBe(400);
    }
  });
});
