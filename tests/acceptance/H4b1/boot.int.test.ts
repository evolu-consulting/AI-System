// HUB-FR-68 · HUB-FR-04 · AC-H4b1-06 · Q2 · plan §4, D10 · test-plan H4b1 §3 A110–A115: `server.ts` với `HUB_SECRETS_KEY`
// thiếu / sai độ dài / không phải base64 / trùng `SECRET_MASTER_KEY` ⇒ thoát ≠ 0 trong ≤ 15 s, không mở cổng, log có
// `hub_secrets_key_invalid` + reason, KHÔNG chứa giá trị khoá; khoá hợp lệ khác master ⇒ Hub lên (/health 200).
// Đỏ trước code: server chưa kiểm khoá ⇒ vẫn chạy (bị kill sau 15 s) ⇒ `code` null ≠ kỳ vọng. A115 xanh trước code (hồi quy).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { HUB_API_URL, type Keys, makeKeys, REDIS_TEST_URL, waitFor } from "../H1/_fixtures";
import { setupH3b } from "../H3b/_h3b";
import { KEY_B64, type Sql } from "./_h4b1";

const REPO = resolve(import.meta.dir, "../../..");
let sql: Sql;
let k: Keys;
beforeAll(async () => {
  sql = await setupH3b();
  k = await makeKeys();
}, 60_000);
afterAll(async () => {
  await sql?.end();
});

const port = () => 45_000 + (process.pid % 1000) + Math.floor(Math.random() * 500);
const health = async (p: number): Promise<number> => {
  try {
    return (await fetch(`http://localhost:${p}/health`, { signal: AbortSignal.timeout(1000) }))
      .status;
  } catch {
    return 0;
  }
};
const MASTER_OK = randomBytes(32).toString("base64");
type Boot = { code: number | null; out: string; port: number; alive: number };
/** Spawn `server.ts`; chờ thoát ≤ `ms` (null = còn chạy ⇒ đo /health rồi kill). */
async function boot(over: Record<string, string | undefined>, ms = 15_000): Promise<Boot> {
  const p = port();
  const env: Record<string, string | undefined> = {
    ...process.env,
    APP_ENV: "test",
    HUB_PORT: String(p),
    HUB_DATABASE_URL: HUB_API_URL,
    REDIS_URL: REDIS_TEST_URL,
    JWT_PUBLIC_KEY: k.publicPem,
    HUB_INSTANCE_ID: "qc-boot-h4b1",
    LOG_LEVEL: "info",
    SECRET_MASTER_KEY: MASTER_OK,
    ...over,
  };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  const proc = Bun.spawn(["bun", "apps/hub-api/src/server.ts"], {
    cwd: REPO,
    env: env as Record<string, string>,
    stdout: "pipe",
    stderr: "pipe",
  });
  let out = "";
  const drain = async (s: ReadableStream<Uint8Array>) => {
    for await (const c of s) out += new TextDecoder().decode(c);
  };
  void drain(proc.stdout);
  void drain(proc.stderr);
  const code = await Promise.race([proc.exited, Bun.sleep(ms).then(() => null)]);
  const alive = code === null ? await health(p) : 0;
  if (code === null) proc.kill();
  await proc.exited;
  return { code, out, port: p, alive };
}

describe("A110–A114 · khoá sai ⇒ không khởi động [AC-H4b1-06]", () => {
  const short = Buffer.from(randomBytes(16)).toString("base64");
  const cases: [string, Record<string, string | undefined>, string, string | null][] = [
    ["A110 · thiếu HUB_SECRETS_KEY", { HUB_SECRETS_KEY: undefined }, "missing", null],
    ["A111 · HUB_SECRETS_KEY rỗng", { HUB_SECRETS_KEY: "" }, "missing", null],
    ["A112 · 16 byte (sai độ dài)", { HUB_SECRETS_KEY: short }, "invalid", short],
    [
      "A113 · không phải base64",
      { HUB_SECRETS_KEY: "qc-khoa-sai-QCMARK-H4B1!!" },
      "invalid",
      "QCMARK-H4B1",
    ],
    [
      "A114 · trùng SECRET_MASTER_KEY",
      { HUB_SECRETS_KEY: KEY_B64, SECRET_MASTER_KEY: KEY_B64 },
      "same_as_master",
      KEY_B64,
    ],
  ];
  for (const [name, over, reason, secret] of cases)
    it(`HUB-FR-68 · AC-H4b1-06 · ${name} ⇒ thoát ≠ 0, cổng không mở, log \`hub_secrets_key_invalid\` reason ${reason}, không chứa khoá`, async () => {
      const r = await boot(over);
      expect(r.code).not.toBeNull();
      expect(r.code).not.toBe(0);
      expect(await health(r.port)).toBe(0);
      expect(r.out).toContain("hub_secrets_key_invalid");
      expect(r.out).toContain(`"reason":"${reason}"`);
      if (secret) expect(r.out).not.toContain(secret);
    }, 40_000);
});

describe("A115 · khoá hợp lệ [AC-H4b1-06 · hồi quy]", () => {
  it("HUB-FR-68 · AC-H4b1-06 · A115 · HUB_SECRETS_KEY 32 byte khác master ⇒ Hub lên, /health 200; log không chứa khoá", async () => {
    const good = randomBytes(32).toString("base64");
    const p = port();
    const env: Record<string, string | undefined> = {
      ...process.env,
      APP_ENV: "test",
      HUB_PORT: String(p),
      HUB_DATABASE_URL: HUB_API_URL,
      REDIS_URL: REDIS_TEST_URL,
      JWT_PUBLIC_KEY: k.publicPem,
      HUB_INSTANCE_ID: "qc-boot-h4b1-ok",
      SECRET_MASTER_KEY: MASTER_OK,
      HUB_SECRETS_KEY: good,
    };
    for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
    const proc = Bun.spawn(["bun", "apps/hub-api/src/server.ts"], {
      cwd: REPO,
      env: env as Record<string, string>,
      stdout: "pipe",
      stderr: "pipe",
    });
    let out = "";
    void (async () => {
      for await (const c of proc.stderr) out += new TextDecoder().decode(c);
    })();
    void (async () => {
      for await (const c of proc.stdout) out += new TextDecoder().decode(c);
    })();
    try {
      const st = await waitFor(
        () => health(p),
        (s) => s === 200,
        20_000,
      );
      expect(st).toBe(200);
      expect(out).not.toContain(good);
    } finally {
      proc.kill();
      await proc.exited;
    }
  }, 40_000);
});
