// N5B-NFR-01 · ADM-NFR-03: POST /auth/login p95 < 150 ms với nhánh legacy (spec N5b §7 R5). In số đo:
// "trước" = sau sunset (chỉ argon2, đúng hành vi M1), "sau" = trước sunset (argon2 ‖ scrypt), và login legacy lần đầu (+ rehash).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { createDb, hashPassword, runMigrations } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import postgres from "postgres";
import { createApp } from "../../app";
import { loadJwtKeys } from "../../lib/jwt";
import { importableHash } from "../identity-import/domain/import.rules";
import { createDummyHash } from "./auth.service";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const TID = "01900000-0000-7000-8000-00000000b5f1";
const PW = "bí mật 123";
const LEGACY = importableHash(
  "scrypt$00112233445566778899aabbccddeeff$" +
    "89dfac31c7b8af82a758ec98fdbf0505a8091293ae8613a019f69f85300419ba" +
    "5e62dcbff56e3be6fb74f27bff7d97b0413126355726a7d4b539e475617504a5",
) as string;
const RUNS = 20;
const owner = postgres(OWNER, { max: 2, onnotice: () => {} });
const db = createDb(API, { max: 10 });
type App = ReturnType<typeof createApp>;
let on: App;
let off: App;

const p95 = (xs: number[]) =>
  [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1] as number;
const login = async (app: App, username: string): Promise<Response> =>
  app.request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenant_key: "perf-n5b", username, password: PW }),
  });

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  await owner`insert into admin.tenants (id, key, name) values (${TID}, 'perf-n5b', 'Perf')`;
  await owner`insert into admin.users (tenant_id, username, password_hash, display_name, role)
    select ${TID}::uuid, 'leg' || g, ${LEGACY}, 'L', 'member' from generate_series(1, ${RUNS + 3}) g
    union all select ${TID}::uuid, 'argon', ${await hashPassword(PW)}, 'A', 'member'`;
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const keys = await loadJwtKeys({
    JWT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    JWT_PUBLIC_KEY: publicKey.export({ type: "spki", format: "pem" }).toString(),
    JWT_KID: "perf",
  });
  const deps = { db, keys, appEnv: "test" as const, dummyHash: await createDummyHash() };
  const cfg = { version: "0.0.0", corsOrigins: ["http://localhost:3000"] };
  on = createApp(cfg, { ...deps, legacySunset: new Date("2999-01-01T00:00:00.000Z") });
  off = createApp(cfg, { ...deps, legacySunset: new Date("2000-01-01T00:00:00.000Z") });
}, 60_000);
afterAll(async () => {
  await db.close();
  await owner.end();
});

async function timed(fn: (i: number) => Promise<Response>): Promise<number[]> {
  for (let w = 0; w < 3; w++) expect((await fn(RUNS + w)).status).toBe(200);
  const out: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    const res = await fn(i);
    out.push(performance.now() - t0);
    expect(res.status).toBe(200);
  }
  return out;
}

describe("N5B-NFR-01 · login p95 < 150 ms (ADM-NFR-03)", () => {
  test("N5B-NFR-01 · argon2 trước/sau + legacy lần đầu (rehash)", async () => {
    const before = p95(await timed(() => login(off, "argon")));
    const after = p95(await timed(() => login(on, "argon")));
    const legacyFirst = p95(await timed((i) => login(on, `leg${i + 1}`)));
    console.log(
      `N5b perf p95 ms: argon2 sau sunset (=M1) ${before.toFixed(1)} · argon2 trước sunset ${after.toFixed(1)} · legacy lần đầu ${legacyFirst.toFixed(1)}`,
    );
    for (const x of [before, after, legacyFirst]) expect(x).toBeLessThan(150);
  }, 60_000);
});
