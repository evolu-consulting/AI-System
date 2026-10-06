// X1-AC14 · X1-R12 · K8 · CORS ba web origin (plan §3; test-plan §2 AC14): admin-api THẬT với `CORS_ORIGINS` 3 origin;
// hub-api THẬT với `HUB_CORS_ORIGINS` 3 origin và với mặc định (biến vắng ⇒ chỉ :3100). Tiến trình thật để kiểm cả
// đường đọc env (tách dấu phẩy). DB: admin = DB qc (createM2Env), Hub = `HUB_TEST_DATABASE_URL` (prepareDb H1).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  HUB_API_URL,
  insertFixture,
  type Keys,
  makeKeys,
  ownerSql,
  prepareDb,
  REDIS_TEST_URL,
} from "../H1/_fixtures";
import { insertHubConfig } from "../H1/_hub";
import { ADMIN_API_URL, createM2Env, type M2Env } from "../M2/_fixtures";
import { adminEnv, type Proc, spawnProc, waitHealth } from "./_x1";

const ADMIN_PORT = 3097;
const HUB_PORT = 4051;
const HUB_PORT_DEFAULT = 4052;
const WEB = ["http://localhost:3000", "http://localhost:3100", "http://localhost:3200"] as const;
const EVIL = "http://evil.test";

let env: M2Env;
let k: Keys;
let adminP: Proc;
let hubP: Proc;
let hubDefault: Proc;

const hubEnv = (port: number, cors: string | undefined) => ({
  APP_ENV: "test",
  HUB_PORT: String(port),
  HUB_DATABASE_URL: HUB_API_URL,
  REDIS_URL: REDIS_TEST_URL,
  JWT_PUBLIC_KEY: k.publicPem,
  HUB_INSTANCE_ID: `qc-x1-cors-${port}`,
  HUB_CORS_ORIGINS: cors,
  LOG_LEVEL: "info",
});

beforeAll(async () => {
  env = await createM2Env();
  await prepareDb();
  const hubSql = ownerSql();
  await insertFixture(hubSql);
  await insertHubConfig(hubSql);
  await hubSql.end();
  k = await makeKeys();
  adminP = spawnProc(
    "apps/admin-api/src/server.ts",
    ADMIN_PORT,
    adminEnv(ADMIN_PORT, ADMIN_API_URL, env.masterKeyB64, { CORS_ORIGINS: WEB.join(",") }),
  );
  hubP = spawnProc(
    "apps/hub-api/src/server.ts",
    HUB_PORT,
    hubEnv(HUB_PORT, [WEB[1], WEB[0], WEB[2]].join(",")),
  );
  hubDefault = spawnProc(
    "apps/hub-api/src/server.ts",
    HUB_PORT_DEFAULT,
    hubEnv(HUB_PORT_DEFAULT, undefined),
  );
  const st = await Promise.all([waitHealth(adminP), waitHealth(hubP), waitHealth(hubDefault)]);
  if (st.some((s) => s !== 200)) {
    throw new Error(
      `tiến trình không lên: ${st.join(",")}\n${adminP.output().slice(-800)}\n${hubP.output().slice(-800)}`,
    );
  }
}, 90_000);
afterAll(async () => {
  await adminP?.stop();
  await hubP?.stop();
  await hubDefault?.stop();
  await env?.close();
});

async function preflight(base: string, path: string, origin: string): Promise<Headers> {
  const res = await fetch(`${base}${path}`, {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "authorization,content-type",
    },
  });
  return res.headers;
}

describe("X1-AC14 · admin-api CORS_ORIGINS", () => {
  it("X1-AC14 · K8 · preflight từ 3000/3100/3200 → allow-origin = origin, allow-credentials true", async () => {
    for (const o of WEB) {
      const h = await preflight(adminP.base, "/auth/login", o);
      expect([o, h.get("access-control-allow-origin")]).toEqual([o, o]);
      expect([o, h.get("access-control-allow-credentials")]).toEqual([o, "true"]);
    }
  });

  it("X1-AC14 · origin lạ (evil.test) → không có access-control-allow-origin", async () => {
    const h = await preflight(adminP.base, "/auth/login", EVIL);
    expect(h.get("access-control-allow-origin")).toBeNull();
  });
});

describe("X1-AC14 · hub-api HUB_CORS_ORIGINS", () => {
  it("X1-AC14 · K8 · HUB_CORS_ORIGINS 3 origin → preflight từ 3000/3100/3200 được phép; evil.test không", async () => {
    for (const o of WEB) {
      const h = await preflight(hubP.base, "/conversations", o);
      expect([o, h.get("access-control-allow-origin")]).toEqual([o, o]);
    }
    expect(
      (await preflight(hubP.base, "/conversations", EVIL)).get("access-control-allow-origin"),
    ).toBeNull();
  });

  it("X1-AC14 · X1-R12 · Hub mặc định (vắng HUB_CORS_ORIGINS) → chỉ :3100; :3000 và :3200 không được phép", async () => {
    expect(
      (await preflight(hubDefault.base, "/conversations", WEB[1])).get(
        "access-control-allow-origin",
      ),
    ).toBe(WEB[1]);
    for (const o of [WEB[0], WEB[2]]) {
      expect([
        o,
        (await preflight(hubDefault.base, "/conversations", o)).get("access-control-allow-origin"),
      ]).toEqual([o, null]);
    }
  });
});
