// CR-118 · cr118-r1-fixes #3 · PUT /me/default-app chỉ chạm MỘT tenant: bump `profile_version` + NOTIFY `profile_changed`
// (kèm tenant_id) cùng transaction, `config_version` toàn cục giữ nguyên (mọi hub không phải nạp lại cả ảnh Admin); hạn mức 429.
// Hạn mức nằm trong tiến trình (dùng chung giữa các file int cùng lô) ⇒ user riêng của file này (lan, thu).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { PROFILE_CHANNEL, ProfileChangedPayloadSchema } from "@ai/contracts";
import { createDb } from "@ai/db";
import { TENANT_ID } from "../../../../../tests/acceptance/M1/_data";
import { ADMIN_API_URL, createEnv, type Env } from "../../../../../tests/acceptance/M1/_fixtures";
import { seedAppUrls } from "./app-catalog.seed";
import { DEFAULT_APP_RATE } from "./portal.service";

let env: Env;
beforeAll(async () => {
  env = await createEnv();
  await env.reset();
  const db = createDb(ADMIN_API_URL, { max: 1 });
  try {
    await seedAppUrls(db, { APP_URL_CHAT: "https://chat.example.com" });
  } finally {
    await db.close();
  }
});
afterAll(async () => {
  await env.close();
});

const versions = async () => {
  const [r] = await env.owner<{ c: number; p: string }[]>`
    select config_version as c, profile_version::text as p from admin.config_meta where id = 1`;
  return { config: r?.c ?? -1, profile: Number(r?.p ?? -1) };
};
const put = async (tenant: string, user: string, app: string | null) =>
  env.call("PUT", "/me/default-app", { token: await env.token(tenant, user), body: { app } });

describe("CR-118 · cr118-r1-fixes · default_app chỉ bump profile_version", () => {
  it("PUT /me/default-app bump profile_version, không bump config_version", async () => {
    const got: string[] = [];
    let notified: () => void = () => {};
    const arrived = new Promise<void>((r) => {
      notified = r;
    });
    const sub = await env.owner.listen(PROFILE_CHANNEL, (p) => {
      got.push(p);
      notified();
    });
    try {
      const v0 = await versions();
      const r = await put("acme", "lan", "chat");
      expect(r.status).toBe(200);
      await arrived;
      const v1 = await versions();
      const payload = ProfileChangedPayloadSchema.parse(JSON.parse(got[0] ?? "null"));
      expect({
        config: v1.config - v0.config,
        profile: v1.profile - v0.profile,
        payload: { entity: payload.entity, tenant: payload.tenant_id, v: payload.v },
      }).toEqual({
        config: 0,
        profile: 1,
        payload: { entity: "user", tenant: TENANT_ID.acme, v: v1.profile },
      });
      // cùng giá trị ⇒ không bump
      expect((await put("acme", "lan", "chat")).status).toBe(200);
      expect(await versions()).toEqual(v1);
    } finally {
      await sub.unlisten();
    }
  });

  it("PUT /me/default-app quá hạn mức ⇒ 429", async () => {
    const codes: number[] = [];
    for (let i = 0; i <= DEFAULT_APP_RATE.max; i++)
      codes.push((await put("acme", "thu", i % 2 ? "chat" : null)).status);
    expect({ okFirst: codes[0], last: codes[DEFAULT_APP_RATE.max] }).toEqual({
      okFirst: 200,
      last: 429,
    });
  });
});
