// HUB-FR-89 · HUB-BR-08 · HUB-H1-AC-11 · H1-R16 · test-plan H1 §5 A42–A47: `hub:seed` (runHubSeed) idempotent + NOTIFY,
// yaml sai không ghi gì, production không `fake-cli`, grant user lạ bỏ qua + cảnh báo, hub-api không khởi động khi thiếu/tắt
// Orchestrator, yaml không chứa chuỗi dạng secret. Seed yaml mặc định của D3: `apps/hub-api/seed/*.yaml` (plan §3.6).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HubConfigChangedPayloadSchema } from "@ai/contracts/hub";
import { setSink } from "../../../apps/hub-api/src/lib/logger";
import { runHubSeed } from "../../../apps/hub-api/src/modules/seed/seed";
import {
  HUB_API_URL,
  insertFixture,
  type Json,
  makeKeys,
  OWNER_URL,
  ownerSql,
  prepareDb,
  REDIS_TEST_URL,
  type Sql,
} from "./_fixtures";
import { insertHubConfig } from "./_hub";

const REPO = resolve(import.meta.dir, "../../..");
const SEED_DIR = join(REPO, "apps/hub-api/seed");
let sql: Sql;

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
}, 60_000);
afterAll(async () => {
  await sql?.end();
});

const yamlFiles = (dir: string): string[] =>
  readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort();

/** Ảnh chụp cấu hình Hub (A43: yaml sai không ghi gì). */
async function snapshot(): Promise<Json> {
  const [r] = await sql`select
    (select hub_config_version from hub.config_meta where id = 1) as version,
    (select coalesce(json_agg(key order by key), '[]') from hub.providers) as providers,
    (select coalesce(json_agg(key order by key), '[]') from hub.model_profiles) as profiles,
    (select coalesce(json_agg(json_build_object('k', key, 'e', enabled, 'v', version) order by key), '[]')
       from hub.agents) as agents,
    (select count(*)::int from hub.agent_entitlements) as entitlements,
    (select count(*)::int from hub.agent_grants) as grants,
    (select count(*)::int from hub.orchestrator_settings) as settings`;
  return r;
}

/** Bản sao thư mục seed mặc định, thay chuỗi `from` → `to` (phải có trong yaml, nếu không ca đỏ ở `expect`). */
function mutatedSeed(from: string | RegExp, to: string): string {
  const dir = mkdtempSync(join(tmpdir(), "qc-h1-seed-"));
  cpSync(SEED_DIR, dir, { recursive: true });
  let hit = 0;
  for (const f of yamlFiles(dir)) {
    const p = join(dir, f);
    const text = readFileSync(p, "utf8");
    const next = text.replace(from, to);
    if (next !== text) {
      hit++;
      writeFileSync(p, next);
    }
  }
  expect(hit).toBeGreaterThan(0);
  return dir;
}

/** Xoá cấu hình Hub (về trạng thái chưa seed) — dùng sau A46. */
async function clearHubConfig(): Promise<void> {
  await sql`delete from hub.agent_grants`;
  await sql`delete from hub.agent_entitlements`;
  await sql`delete from hub.orchestrator_settings`;
  await sql`delete from hub.agents`;
  await sql`delete from hub.model_profiles`;
  await sql`delete from hub.provider_state`;
  await sql`delete from hub.providers`;
  await sql`update hub.config_meta set hub_config_version = 0 where id = 1`;
}

describe("A46 · hub-api không khởi động khi thiếu/tắt Orchestrator [HUB-BR-08]", () => {
  /** Chạy `server.ts` thật (env tường minh); trả mã thoát sau ≤ 10 s (còn chạy → kill, mã null). */
  async function boot(): Promise<{ code: number | null; out: string }> {
    const k = await makeKeys();
    const proc = Bun.spawn(["bun", "apps/hub-api/src/server.ts"], {
      cwd: REPO,
      env: {
        ...process.env,
        APP_ENV: "test",
        HUB_PORT: String(41_000 + (process.pid % 1000)),
        HUB_DATABASE_URL: HUB_API_URL,
        REDIS_URL: REDIS_TEST_URL,
        JWT_PUBLIC_KEY: k.publicPem,
        HUB_INSTANCE_ID: "qc-boot",
        LOG_LEVEL: "info",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await Promise.race([proc.exited, Bun.sleep(10_000).then(() => null)]);
    if (code === null) proc.kill();
    await proc.exited;
    const out = `${await new Response(proc.stdout).text()}${await new Response(proc.stderr).text()}`;
    return { code, out };
  }

  it("A46 · thiếu orchestrator_settings → log fatal, exit 1 [HUB-BR-08]", async () => {
    const r = await boot();
    expect(r.code).toBe(1);
    expect(r.out).toContain("fatal");
  }, 30_000);

  it("A46 · agent Orchestrator enabled=false → log fatal, exit 1 [HUB-BR-08]", async () => {
    await insertHubConfig(sql);
    await sql`update hub.agents set enabled = false where key = 'orchestrator'`;
    try {
      const r = await boot();
      expect(r.code).toBe(1);
      expect(r.out).toContain("fatal");
    } finally {
      await clearHubConfig();
    }
  }, 30_000);
});

describe("A42–A45, A47 · hub:seed [HUB-FR-89 · HUB-H1-AC-11 · H1-R16]", () => {
  it("A44 · seed APP_ENV=production → không có provider fake-cli, agent dùng profile claude-sub-1 [plan §3.6 · §7]", async () => {
    await runHubSeed({ url: OWNER_URL, dir: SEED_DIR, appEnv: "production" });
    const ps = await sql<{ key: string }[]>`select key from hub.providers order by key`;
    expect(ps.map((p) => p.key)).not.toContain("fake-cli");
    expect(ps.map((p) => p.key)).toContain("claude-sub");
    const ag = await sql<{ key: string; profile: string }[]>`select a.key, p.key as profile
      from hub.agents a join hub.model_profiles p on p.id = a.profile_id order by a.key`;
    expect(
      ag.filter((a) => ["orchestrator", "assistant"].includes(a.key)).map((a) => a.profile),
    ).toEqual(["claude-sub-1", "claude-sub-1"]);
  });

  it("A42 · seed 2 lần → không trùng, hub_config_version +2, 2 NOTIFY hub_config_changed hợp contract [HUB-H1-AC-11]", async () => {
    const listener = ownerSql();
    const notes: Json[] = [];
    const sub = await listener.listen("hub_config_changed", (raw) => {
      try {
        notes.push(JSON.parse(raw));
      } catch {
        notes.push(raw);
      }
    });
    try {
      const v0 = (await snapshot())?.version ?? 0;
      const r1 = await runHubSeed({ url: OWNER_URL, dir: SEED_DIR, appEnv: "test" });
      const s1 = await snapshot();
      const r2 = await runHubSeed({ url: OWNER_URL, dir: SEED_DIR, appEnv: "test" });
      const s2 = await snapshot();
      expect([r1.version, r2.version]).toEqual([v0 + 1, v0 + 2]);
      expect(s2?.version).toBe(v0 + 2);
      expect({ ...s2, version: 0 }).toEqual({ ...s1, version: 0 });
      expect(s2?.providers).toEqual(expect.arrayContaining(["claude-sub", "fake-cli"]));
      expect(s2?.settings).toBe(1);
      const deadline = Date.now() + 3_000;
      while (notes.length < 2 && Date.now() < deadline) await Bun.sleep(25);
      expect(notes.map((n) => HubConfigChangedPayloadSchema.safeParse(n).success)).toEqual([
        true,
        true,
      ]);
      expect(notes.map((n) => n?.version)).toEqual([v0 + 1, v0 + 2]);
    } finally {
      await sub.unlisten();
      await listener.end();
    }
  });

  for (const [name, from, to] of [
    ["key agent sai định dạng (Bad)", /key:\s*assistant\b/, "key: Bad"],
    ["provider lạ trong profile", /provider_key:\s*fake-cli\b/, "provider_key: khong-co-provider"],
  ] as const) {
    it(`A43 · yaml sai — ${name} → runHubSeed lỗi, không ghi gì (version, bảng cấu hình giữ nguyên) [HUB-H1-AC-11]`, async () => {
      const dir = mutatedSeed(from, to);
      try {
        const before = await snapshot();
        let threw = false;
        try {
          await runHubSeed({ url: OWNER_URL, dir, appEnv: "test" });
        } catch {
          threw = true;
        }
        expect(threw).toBe(true);
        expect(await snapshot()).toEqual(before);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  it("A45 · grant cho user không tồn tại → bỏ grant đó + log cảnh báo, phần còn lại vẫn ghi [Q8]", async () => {
    const dir = mutatedSeed(/group:beta-testers/, "user:khong-ton-tai");
    const lines: { level: string; line: string }[] = [];
    const restore = setSink((level, line) => lines.push({ level, line }));
    try {
      const before = await snapshot();
      const r = await runHubSeed({ url: OWNER_URL, dir, appEnv: "test" });
      expect(r.version).toBe((before?.version ?? 0) + 1);
      const [g] = await sql<{ n: number }[]>`select count(*)::int as n from hub.agent_grants g
        where g.subject_type = 'user' and not exists (select 1 from admin.users u where u.id = g.subject_id)`;
      expect(g?.n).toBe(0);
      expect(lines.some((l) => l.level === "warn" && l.line.includes("khong-ton-tai"))).toBe(true);
    } finally {
      restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("A47 · yaml seed không chứa chuỗi dạng secret (sk-, BEGIN, password:) [H1-R16]", () => {
    const files = yamlFiles(SEED_DIR);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const text = readFileSync(join(SEED_DIR, f), "utf8");
      expect(text).not.toMatch(/sk-[A-Za-z0-9]/);
      expect(text).not.toContain("BEGIN");
      expect(text).not.toMatch(/password\s*:/i);
    }
  });
});
