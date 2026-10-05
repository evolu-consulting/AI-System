// HUB-FR-44 · H2c-R04 · HUB-H2c-AC-15 · test-plan-int §2.3 A25–A29: khởi động hub-api với `HUB_ATTACH_*` sai → thoát ≠ 0
// (không mở cổng, không in giá trị env); thư mục chưa có → tạo; driver `createLocalStorage({dir})` (L8): khoá sai/thoát gốc
// → `StorageKeyError`, hai pha `stage → commit/discard`, `StorageTooLarge`, `StorageRejected`, `.part` mở `wx`, `open`/
// `remove`/`list`/`blob`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { chmod, mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  type AttachmentStorage,
  StorageKeyError,
  StorageRejected,
  StorageTooLarge,
} from "../../../apps/hub-api/src/modules/attachments/storage";
import { createLocalStorage } from "../../../apps/hub-api/src/modules/attachments/storage.local";
import {
  HUB_API_URL,
  insertFixture,
  type Keys,
  makeKeys,
  ownerSql,
  prepareDb,
  REDIS_TEST_URL,
  type Sql,
  waitFor,
} from "../H1/_fixtures";
import { insertHubConfig } from "../H1/_hub";
import { diskFiles, rawGet, rmDir, sha256, tempDir } from "./_h2c";

const REPO = resolve(import.meta.dir, "../../..");
const WIN = process.platform === "win32";
let sql: Sql;
let k: Keys;
const dirs: string[] = [];

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  k = await makeKeys();
}, 60_000);
afterEach(async () => {
  for (const d of dirs.splice(0)) {
    if (!WIN) await chmod(d, 0o700).catch(() => {});
    await rmDir(d);
  }
});
afterAll(async () => {
  await sql?.end();
});

const newDir = async (tag: string) => {
  const d = await tempDir(tag);
  dirs.push(d);
  return d;
};
const uuid = () => crypto.randomUUID();
const keyOf = (t = uuid(), id = uuid()) => `${t}/${id}`;
const streamOf = (...chunks: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(ctl) {
      for (const c of chunks) ctl.enqueue(c);
      ctl.close();
    },
  });
const bytes = (s: string) => new TextEncoder().encode(s);
/** Lỗi `fn` ném (hoặc "ok"). */
const thrown = (p: Promise<unknown>) =>
  p.then(
    () => "ok" as unknown,
    (e: unknown) => e,
  );

// ---------- A25–A26 · khởi động ----------
type Boot = { code: number | null; out: string; port: number };
const port = () => 44_000 + (process.pid % 1000) + Math.floor(Math.random() * 500);
/** Spawn `server.ts` với env tối thiểu + `attach`; chờ thoát ≤ `ms` (null = vẫn chạy, đã kill). */
async function boot(attach: Record<string, string | undefined>, ms = 10_000): Promise<Boot> {
  const p = port();
  const env: Record<string, string | undefined> = {
    ...process.env,
    APP_ENV: "test",
    HUB_PORT: String(p),
    HUB_DATABASE_URL: HUB_API_URL,
    REDIS_URL: REDIS_TEST_URL,
    JWT_PUBLIC_KEY: k.publicPem,
    HUB_INSTANCE_ID: "qc-boot-h2c",
    LOG_LEVEL: "info",
    HUB_ATTACH_DRIVER: undefined,
    HUB_ATTACH_DIR: undefined,
    ...attach,
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
  if (code === null) proc.kill();
  await proc.exited;
  return { code, out, port: p };
}

describe("A25–A26 · khởi động với HUB_ATTACH_* [H2c-R04 · HUB-H2c-AC-15]", () => {
  const MARK = "qc-h2c-marker-dir";
  const cases: [string, () => Promise<Record<string, string | undefined>>][] = [
    [
      "HUB_ATTACH_DRIVER=s3",
      async () => ({ HUB_ATTACH_DRIVER: "s3", HUB_ATTACH_DIR: await newDir(MARK) }),
    ],
    ["HUB_ATTACH_DRIVER vắng", async () => ({ HUB_ATTACH_DIR: await newDir(MARK) })],
    [
      "HUB_ATTACH_DIR tương đối rel/x",
      async () => ({ HUB_ATTACH_DRIVER: "local", HUB_ATTACH_DIR: `rel/${MARK}` }),
    ],
    [
      "HUB_ATTACH_DIR là file thường (không ghi được)",
      async () => {
        const d = await newDir(MARK);
        const f = join(d, "la-file");
        await writeFile(f, "x");
        return { HUB_ATTACH_DRIVER: "local", HUB_ATTACH_DIR: f };
      },
    ],
  ];
  if (!WIN)
    cases.push([
      "HUB_ATTACH_DIR chmod 0500 (Linux)",
      async () => {
        const d = await newDir(MARK);
        await chmod(d, 0o500);
        return { HUB_ATTACH_DRIVER: "local", HUB_ATTACH_DIR: d };
      },
    ]);
  for (const [name, env] of cases)
    it(`HUB-FR-44 · A25 · ${name} → server.ts thoát ≠ 0 trong ≤ 10 s, không cổng mở, log không chứa giá trị env [H2c-R04 · AC-15]`, async () => {
      const r = await boot(await env());
      expect(r.code).not.toBeNull();
      expect(r.code).not.toBe(0);
      expect(await rawGet(r.port)).toBe(0);
      expect(r.out).not.toContain(MARK);
      expect(r.out).not.toContain('"s3"');
    }, 30_000);

  it("HUB-FR-44 · A26 · HUB_ATTACH_DIR chưa tồn tại → Hub lên (/health 200), thư mục được tạo (0700 khi không win32) [H2c-R04]", async () => {
    const parent = await newDir("a26");
    const dir = join(parent, "chua-co", "attachments");
    const p = port();
    const proc = Bun.spawn(["bun", "apps/hub-api/src/server.ts"], {
      cwd: REPO,
      env: {
        ...process.env,
        APP_ENV: "test",
        HUB_PORT: String(p),
        HUB_DATABASE_URL: HUB_API_URL,
        REDIS_URL: REDIS_TEST_URL,
        JWT_PUBLIC_KEY: k.publicPem,
        HUB_INSTANCE_ID: "qc-boot-h2c-a26",
        LOG_LEVEL: "info",
        HUB_ATTACH_DRIVER: "local",
        HUB_ATTACH_DIR: dir,
      },
      stdout: "ignore",
      stderr: "ignore",
    });
    try {
      const st = await waitFor(
        () => rawGet(p),
        (s) => s === 200 || proc.exitCode !== null,
        15_000,
      );
      expect(st).toBe(200);
      const s = await stat(dir).catch(() => null);
      expect(s?.isDirectory()).toBe(true);
      if (!WIN) expect((s?.mode ?? 0) & 0o777).toBe(0o700);
    } finally {
      proc.kill();
      await proc.exited;
    }
  }, 30_000);
});

// ---------- A27–A29 · driver local ----------
describe("A27–A29 · driver createLocalStorage({dir}) [H2c-R04 · R05 · PL1 · L8]", () => {
  let dir = "";
  let st: AttachmentStorage;
  const mk = async () => {
    dir = await newDir("drv");
    st = await createLocalStorage({ dir });
    return st;
  };

  it("HUB-FR-44 · A27 · stage('../x'), stage('t/../id'), khoá chữ hoa → StorageKeyError, không file ngoài gốc; thư mục tenant là symlink/junction ra ngoài gốc → StorageKeyError [H2c-R04 · AC-15 · Q-T5]", async () => {
    await mk();
    const outside = await newDir("ngoai");
    const t = uuid();
    const bad = ["../x", `${t}/../${uuid()}`, keyOf().toUpperCase(), `../${uuid()}`];
    for (const key of bad) {
      const e = await thrown(st.stage(key, streamOf(bytes("x")), { maxBytes: 100 }));
      expect({ key, err: e instanceof StorageKeyError }).toEqual({ key, err: true });
    }
    expect(await diskFiles(outside)).toEqual([]);
    const tenant = uuid();
    let linked = false;
    try {
      await symlink(outside, join(dir, tenant), WIN ? "junction" : "dir");
      linked = true;
    } catch {
      linked = false;
    }
    if (linked) {
      const e = await thrown(st.stage(keyOf(tenant), streamOf(bytes("x")), { maxBytes: 100 }));
      expect(e instanceof StorageKeyError).toBe(true);
      expect(await diskFiles(outside)).toEqual([]);
    }
  });

  it("HUB-FR-44 · A28 · stage → discard → không .part; stage → commit → file (size, sha256), .part mất; vượt maxBytes → StorageTooLarge, không .part; inspect false → StorageRejected; .part có sẵn cùng key → lỗi, không ghi đè [H2c-R05 · PL1 · PL3]", async () => {
    await mk();
    const k1 = keyOf();
    const s1 = await st.stage(k1, streamOf(bytes("abc")), { maxBytes: 100 });
    await s1.discard();
    expect(await diskFiles(dir)).toEqual([]);
    const k2 = keyOf();
    const body = bytes("noi dung commit");
    const s2 = await st.stage(k2, streamOf(body.subarray(0, 5), body.subarray(5)), {
      maxBytes: 100,
    });
    expect({ size: s2.size, sha: s2.sha256 }).toEqual({ size: body.length, sha: sha256(body) });
    expect(await diskFiles(dir)).toEqual([`${k2}.part`]);
    await s2.commit();
    expect(await diskFiles(dir)).toEqual([k2]);
    expect(new Uint8Array(await readFile(join(dir, ...k2.split("/"))))).toEqual(body);
    const big = await thrown(
      st.stage(keyOf(), streamOf(new Uint8Array(60), new Uint8Array(60)), { maxBytes: 100 }),
    );
    expect(big instanceof StorageTooLarge).toBe(true);
    const rej = await thrown(
      st.stage(keyOf(), streamOf(bytes("x")), {
        maxBytes: 100,
        inspect: { push: () => false, end: () => false },
      }),
    );
    expect(rej instanceof StorageRejected).toBe(true);
    expect(await diskFiles(dir)).toEqual([k2]);
    const k3 = keyOf();
    const [t3, id3] = k3.split("/") as [string, string];
    await mkdir(join(dir, t3), { recursive: true });
    await writeFile(join(dir, t3, `${id3}.part`), "CU");
    const dup = await thrown(st.stage(k3, streamOf(bytes("MOI")), { maxBytes: 100 }));
    expect(dup).not.toBe("ok");
    expect(await readFile(join(dir, t3, `${id3}.part`), "utf8")).toBe("CU");
  });

  it("HUB-FR-44 · A29 · open khoá không có → null; remove không có → ok; list({after:null, limit:2}) sắp theo key, partial đúng, phân trang bằng after; blob(key, mime) → Blob đúng size/type [PL1]", async () => {
    await mk();
    expect(await st.open(keyOf())).toBeNull();
    expect(await thrown(st.remove(keyOf()))).toBe("ok");
    const t = uuid();
    const keys = [keyOf(t), keyOf(t), keyOf(t)].sort() as [string, string, string];
    for (const key of keys.slice(0, 2)) {
      const s = await st.stage(key, streamOf(bytes(`file ${key}`)), { maxBytes: 1000 });
      await s.commit();
    }
    await st.stage(keys[2], streamOf(bytes("dang do")), { maxBytes: 1000 });
    const p1 = await st.list({ after: null, limit: 2 });
    expect(p1.map((e) => [e.key, e.partial])).toEqual([
      [keys[0], false],
      [keys[1], false],
    ]);
    const p2 = await st.list({ after: p1[1]?.key ?? null, limit: 2 });
    expect(p2.map((e) => [e.key, e.partial])).toEqual([[keys[2], true]]);
    const opened = await st.open(keys[0]);
    expect(opened?.size).toBe(bytes(`file ${keys[0]}`).length);
    const blob = await st.blob(keys[1], "application/pdf");
    expect({ size: blob?.size, type: blob?.type }).toEqual({
      size: bytes(`file ${keys[1]}`).length,
      type: "application/pdf",
    });
  });
});
