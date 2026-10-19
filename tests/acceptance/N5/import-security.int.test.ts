// N5-FR-01, N5-FR-04, N5-FR-05, N5-FR-07 · N5-NFR-02 · mật khẩu (nhập hash / buộc đặt lại — đăng nhập thật qua admin-api),
// không lộ hash (stdout/stderr CLI, audit), mã thoát CLI (file hỏng, thiếu --actor, --batch sai — security L4), actor phải là
// platform admin, file/hàng sai (gồm NUL, surrogate lẻ — security M2), audit user → vai (security L3). Dữ liệu GIẢ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../../apps/admin-api/src/app";
import { loadJwtKeys } from "../../../apps/admin-api/src/lib/jwt";
import { createDummyHash } from "../../../apps/admin-api/src/modules/auth/auth.service";
import {
  ImportAbort,
  runIdentityImport,
} from "../../../apps/admin-api/src/modules/identity-import/identity-import.run";
import {
  ADMIN_API_URL,
  argonOf,
  type CtxN5,
  KNOWN_PW,
  mkExport,
  SCRYPT_HASH,
  snapshot,
  startN5,
  USERS,
  userX,
} from "./_support/n5";

const ROOT = join(import.meta.dir, "../../..");
const CLI = join(ROOT, "apps/admin-api/src/modules/identity-import/identity-import.cli.ts");
let c: CtxN5;
let argon: string;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  c = await startN5();
  argon = await argonOf(KNOWN_PW);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const keys = await loadJwtKeys({
    JWT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    JWT_PUBLIC_KEY: publicKey.export({ type: "spki", format: "pem" }).toString(),
    JWT_KID: "n5",
  });
  app = createApp(
    { version: "0.0.0", corsOrigins: ["http://localhost:3000"] },
    { db: c.db, keys, appEnv: "test", dummyHash: await createDummyHash() },
  );
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const login = (tenant_key: string, username: string, password: string) =>
  app.request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenant_key, username, password }),
  });
const run = (raw: unknown, apply: boolean, actorId = c.padmin) =>
  runIdentityImport(c.db, raw, { actorId, apply });
const abortCode = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof ImportAbort ? e.code : `other:${(e as Error).message}`;
  }
};
async function cli(args: string[]) {
  const p = Bun.spawn(["bun", CLI, ...args], {
    cwd: ROOT,
    env: { ...process.env, ADMIN_API_DATABASE_URL: ADMIN_API_URL },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { out, err, code };
}
const tmpFile = async (body: string) => {
  const f = join(tmpdir(), `n5-${Bun.randomUUIDv7()}.json`);
  await Bun.write(f, body);
  return f;
};

describe("N5-FR-04 · mật khẩu", () => {
  const raw = () =>
    mkExport(
      [{ id: "org-pw", name: "Pw", tenant_key: "pw-n5" }],
      [
        userX("argon@pw.test", "org-pw", "editor", argon),
        userX("scrypt@pw.test", "org-pw", "editor", SCRYPT_HASH),
        userX("google@pw.test", "org-pw", "viewer", null),
      ],
    );
  it("N5-FR-04 · argon2id đủ mạnh ⇒ giữ hash, đăng nhập bằng mật khẩu cũ ⇒ 200, không buộc đổi", async () => {
    const r = await run(raw(), true);
    expect(r.users).toMatchObject({ hash_imported: 1, reset_required: 2 });
    expect(r.accounts.find((x) => x.email === "argon@pw.test")).toEqual({
      tenant_key: "pw-n5",
      email: "argon@pw.test",
      username: "argon",
      reset_required: false,
    });
    const res = await login("pw-n5", "argon", KNOWN_PW);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { access_token?: string }).access_token).toBeString();
  });
  it("N5-FR-04 · scrypt/không mật khẩu ⇒ buộc đặt lại, hash argon2id lạ, không đăng nhập được; audit reset_required + vai (L3)", async () => {
    await run(raw(), true);
    const rows = await c.sql<{ username: string; must: boolean; h: string }[]>`select username,
      must_change_password as must, password_hash as h from admin.users
      where lower(email) in ('scrypt@pw.test', 'google@pw.test') order by 1`;
    expect(rows.map((x) => [x.username, x.must])).toEqual([
      ["google", true],
      ["scrypt", true],
    ]);
    for (const x of rows) {
      expect(x.h.startsWith("$argon2id$")).toBe(true);
      expect(x.h).not.toBe(SCRYPT_HASH);
    }
    expect((await login("pw-n5", "scrypt", KNOWN_PW)).status).toBe(401);
    expect((await login("pw-n5", "google", "")).status).not.toBe(200);
    const au = await c.sql<{ u: string; reset: string; role: string }[]>`select a.entity_name as u,
        a.summary->>'reset_required' as reset, a.summary->>'pack_role' as role
      from admin.audit_log a where a.action = 'import' and a.entity = 'user'
        and a.tenant_id = (select id from admin.tenants where key = 'pw-n5') order by 1`;
    expect(au.map((x) => [x.u, x.reset, x.role])).toEqual([
      ["argon", "false", "editor"],
      ["google", "true", "viewer"],
      ["scrypt", "true", "editor"],
    ]);
  });
});

describe("N5-NFR-02 · N5-FR-05 · CLI: không lộ hash, mã thoát", () => {
  it("N5-NFR-02 · --apply: stdout/stderr không chứa hash; audit không chứa hash; exit 2 khi có lỗi hàng", async () => {
    const file = await tmpFile(
      JSON.stringify(
        mkExport(
          [{ id: "org-cli", name: "Cli", tenant_key: "cli-n5" }],
          [
            userX("a@cli.test", "org-cli", "editor", argon),
            userX("b@cli.test", "org-cli", "viewer", SCRYPT_HASH),
            userX("bad-email", "org-cli", "viewer", argon),
          ],
        ),
      ),
    );
    const { out, err, code } = await cli(["--file", file, "--actor", c.padmin, "--apply"]);
    expect(code).toBe(2);
    for (const secret of [argon, SCRYPT_HASH, "$argon2id$", "scrypt:"])
      expect((out + err).includes(secret)).toBe(false);
    const rep = JSON.parse(out) as { users: { created: number }; issues: { code: string }[] };
    expect(rep.users.created).toBe(2);
    expect(rep.issues.map((i) => i.code)).toEqual(["INVALID_EMAIL"]);
    const [leak] = await c.sql<{ n: number }[]>`select count(*)::int as n from admin.audit_log
      where coalesce(after::text, '') || coalesce(before::text, '') || summary::text like '%$argon2%'
         or coalesce(after::text, '') || summary::text like '%scrypt:%'
         or coalesce(after::text, '') || summary::text like '%password_hash%'`;
    expect(leak?.n).toBe(0);
  });
  it("N5-FR-05 · file hỏng / thiếu --actor / --batch không phải số nguyên 1..1000 ⇒ exit 1, không ghi gì", async () => {
    const before = await snapshot(c.sql);
    const broken = await tmpFile("{not json");
    const good = await tmpFile(
      JSON.stringify(mkExport([{ id: "org-x1", name: "X" }], [userX("a@x1.test", "org-x1")])),
    );
    const results = await Promise.all([
      cli(["--file", broken, "--actor", c.padmin, "--apply"]),
      cli(["--file", good, "--apply"]),
      cli(["--file", good, "--actor", c.padmin, "--apply", "--batch", "abc"]),
      cli(["--file", good, "--actor", c.padmin, "--apply", "--batch", "0"]),
      cli(["--file", good, "--actor", c.padmin, "--apply", "--batch", "1001"]),
    ]);
    expect(results.map((x) => [x.code, JSON.parse(x.err.trim()).error])).toEqual([
      [1, "BAD_FILE"],
      [1, "ACTOR_INVALID"],
      [1, "BAD_BATCH"],
      [1, "BAD_BATCH"],
      [1, "BAD_BATCH"],
    ]);
    expect(await snapshot(c.sql)).toEqual(before);
  });
});

describe("N5-FR-07 · N5-FR-01 · actor và file", () => {
  it("N5-FR-07 · actor là tenant_admin / không tồn tại ⇒ ACTOR_INVALID, không ghi gì", async () => {
    const before = await snapshot(c.sql);
    const raw = mkExport([{ id: "o-x", name: "X" }], [userX("a@x.test", "o-x")]);
    expect(await abortCode(run(raw, true, USERS.tadmin.id))).toBe("ACTOR_INVALID");
    expect(await abortCode(run(raw, true, "a1000000-0000-4000-8000-0000000fffff"))).toBe(
      "ACTOR_INVALID",
    );
    expect(await snapshot(c.sql)).toEqual(before);
  });
  it("N5-FR-01 · sai format / thiếu mảng / thiếu source ⇒ BAD_FILE; hàng sai kiểu ⇒ BAD_ROW theo chỉ số", async () => {
    const base = { format: "mgmt-app-users/v1", source: "mgmt-test" };
    expect(await abortCode(run({ ...base, format: "khac", orgs: [], users: [] }, false))).toBe(
      "BAD_FILE",
    );
    expect(await abortCode(run({ ...base, orgs: [] }, false))).toBe("BAD_FILE");
    expect(await abortCode(run({ format: base.format, orgs: [], users: [] }, false))).toBe(
      "BAD_FILE",
    );
    const r = await run(
      { ...base, orgs: [{ id: "o-y", name: "Y" }], users: [{ email: 5 }] },
      false,
    );
    expect(r.issues).toEqual([{ kind: "user", ref: "users[0]", code: "BAD_ROW" }]);
  });
  it("N5-FR-01 · security M2: NUL / surrogate lẻ ⇒ BAD_ROW (không làm hỏng cả lần chạy); hàng khác vẫn tạo", async () => {
    const nul = String.fromCharCode(0);
    const raw = mkExport(
      [
        { id: "org-m2", name: "M2", tenant_key: "m2-n5" },
        { id: `bad${nul}org`, name: "Bad" },
      ],
      [
        { ...userX("ok@m2.test", "org-m2"), name: `${"a".repeat(63)}😀😀` },
        { ...userX("nul@m2.test", "org-m2"), name: `x${nul}y` },
        { ...userX("sur@m2.test", "org-m2"), name: `x${"\uD83D"}` },
      ],
    );
    const r = await run(raw, true);
    expect(r.issues).toEqual([
      { kind: "org", ref: "orgs[1]", code: "BAD_ROW" },
      { kind: "user", ref: "users[1]", code: "BAD_ROW" },
      { kind: "user", ref: "users[2]", code: "BAD_ROW" },
    ]);
    expect(r.users.created).toBe(1);
    const [u] = await c.sql<
      { dn: string }[]
    >`select display_name as dn from admin.users where lower(email) = 'ok@m2.test'`;
    expect(Array.from(u?.dn ?? "")).toHaveLength(64);
  });
});
