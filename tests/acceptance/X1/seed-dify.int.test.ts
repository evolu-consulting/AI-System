// X1-AC16, X1-AC17 · X1-R01..R04, R14 · `seed-dify-live.ts` chạy thật (tiến trình) với `.env` GIẢ trong thư mục tạm (key giả sinh
// lúc chạy, P1) + admin-api THẬT (tiến trình, DB qc) + Hub stub `/agent-grants` + Dify stub đếm lời gọi (phải 0).
// Bước 8 (Hub seed CLI) trỏ DB qc qua `DATABASE_URL` (test-plan §8 mục 5). Không bao giờ đọc `.env` thật của auto-pilot.
// Thứ tự ca có chủ đích (dry-run → apply → apply lần 2 → rotate): đọc kết quả ca trước là một phần kịch bản idempotent.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHubMigrations } from "@ai/db/migrate-hub";
import {
  ADMIN_API_URL,
  createM2Env,
  type M2Env,
  OWNER_URL,
  SEED_PW,
  scanDatabase,
  TENANT_ID,
  USER_ID,
} from "../M2/_fixtures";
import {
  adminEnv,
  fakeDifyKey,
  json,
  leaksIn,
  type Proc,
  ROOT,
  randomToken,
  type Stub,
  spawnProc,
  startStub,
  waitHealth,
} from "./_x1";

const PORT = 3096;
const SCRIPT = "tools/scripts/src/seed-dify-live.ts";
const APPS = ["chatbot", "translate", "gmail-summary", "email-reply", "screenshot-ask"] as const;
const ENV_KEY: Record<(typeof APPS)[number], string> = {
  chatbot: "DIFY_KEY_CHATBOT",
  translate: "DIFY_KEY_TRANSLATE",
  "gmail-summary": "DIFY_KEY_GMAIL",
  "email-reply": "DIFY_KEY_EMAILREPLY",
  "screenshot-ask": "DIFY_KEY_SCREENSHOTASK",
};
const KEYS = Object.fromEntries(APPS.map((a) => [a, fakeDifyKey()])) as Record<
  (typeof APPS)[number],
  string
>;
/** Biến console/agent trong file env: seed KHÔNG được đọc (X1-R01, R05). */
const TRAP = {
  DIFY_CONSOLE_EMAIL: `trap-${randomToken(12)}@qc.test`,
  DIFY_CONSOLE_PASSWORD: `TRAP-${randomToken(24)}`,
  DIFY_AGENT_API_KEY: `app-TRAP${randomToken(24)}`,
};
const AGENT_ID = "01900000-0000-7000-8000-0000000016a1";
const WF_KEYS = [
  "dify-chatbot",
  "dify-email-reply",
  "dify-gmail-summary",
  "dify-screenshot-ask",
  "dify-translate",
];
const CMD_NAMES = ["ask-image", "reply", "summary", "translate"];

let env: M2Env;
let api: Proc;
let hub: Stub;
let dify: Stub;
let adminStub: Stub;
let dir = "";
let envFile = "";
let difyUrl = "";
const outputs: string[] = [];

function writeEnv(name: string, skip: string[] = []): string {
  const lines = [
    "# file env GIẢ của qc (X1-AC16) — không phải key thật",
    `DIFY_API_URL=${difyUrl}`,
    ...APPS.filter((a) => !skip.includes(ENV_KEY[a])).map((a) => `${ENV_KEY[a]}=${KEYS[a]}`),
    ...Object.entries(TRAP).map(([k, v]) => `${k}=${v}`),
  ];
  const p = join(dir, name);
  writeFileSync(p, `${lines.join("\n")}\n`);
  return p;
}

async function seed(
  args: string[],
  over: Record<string, string | undefined> = {},
): Promise<{ code: number | null; out: string }> {
  const merged: Record<string, string | undefined> = {
    ...process.env,
    DIFY_SEED_ENV_FILE: envFile,
    ADMIN_API_URL: api.base,
    HUB_URL_SEED: hub.base,
    SEED_ADMIN_USERNAME: "admin",
    SEED_ADMIN_PASSWORD: SEED_PW,
    DATABASE_URL: OWNER_URL,
    HUB_DATABASE_URL: OWNER_URL,
    DIFY_LIVE: undefined,
    ...over,
  };
  const e: Record<string, string> = {};
  for (const [k, v] of Object.entries(merged)) if (v !== undefined) e[k] = v;
  const proc = Bun.spawn(["bun", SCRIPT, ...args], {
    cwd: ROOT,
    env: e,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [o, er] = await Promise.all([
    new Response(proc.stdout as ReadableStream).text(),
    new Response(proc.stderr as ReadableStream).text(),
  ]);
  const code = await proc.exited;
  const out = `${o}${er}`;
  outputs.push(out);
  return { code, out };
}

const n = async (q: string): Promise<number> => Number((await env.owner.unsafe(q))[0]?.n ?? 0);
const auditMax = () => n("select coalesce(max(seq),0)::int as n from admin.audit_log");
const cfg = () => n("select config_version as n from admin.config_meta");
const writes = (s: Stub) =>
  s.calls.filter((c) => ["POST", "PUT", "PATCH", "DELETE"].includes(c.method));

beforeAll(async () => {
  env = await createM2Env();
  await runHubMigrations({ url: OWNER_URL, appEnv: "test" });
  dir = mkdtempSync(join(tmpdir(), "qc-x1-seed-"));
  dify = startStub(() => json(500, { message: "Dify stub: seed không được gọi Dify" }));
  difyUrl = `${dify.base}/v1`;
  envFile = writeEnv(".env");
  hub = startStub((rec) => {
    if (rec.method === "GET" && rec.path === "/agent-grants")
      return json(200, {
        tenant_id: TENANT_ID.acme,
        items: [
          {
            agent: {
              id: AGENT_ID,
              key: "dify-chatbot",
              name: { vi: "Chatbot (Dify)", en: "Chatbot (Dify)" },
              description: "Agent chatbot Dify cho X1 (stub qc).",
              enabled: true,
              runnable: true,
            },
            grants: [],
            grants_total: 0,
          },
        ],
        truncated: false,
        hub_config_version: 1,
      });
    if (rec.method === "POST" && rec.path === "/agent-grants") {
      const b = JSON.parse(rec.body || "{}");
      return json(201, {
        grant: {
          id: "01900000-0000-7000-8000-0000000016b1",
          tenant_id: TENANT_ID.acme,
          agent: {
            id: AGENT_ID,
            key: "dify-chatbot",
            name: { vi: "Chatbot (Dify)", en: "Chatbot (Dify)" },
          },
          subject: { type: b.subject_type, id: b.subject_id },
          granted_by: "admin",
          granted_at: new Date().toISOString(),
        },
        hub_config_version: 2,
      });
    }
    return json(404, { error: { code: "NOT_FOUND", message: "stub" } });
  });
  adminStub = startStub(() => json(500, { error: { code: "INTERNAL", message: "stub" } }));
  api = spawnProc(
    "apps/admin-api/src/server.ts",
    PORT,
    adminEnv(PORT, ADMIN_API_URL, env.masterKeyB64),
  );
  expect(await waitHealth(api)).toBe(200);
}, 90_000);
afterAll(async () => {
  await api?.stop();
  await hub?.stop();
  await dify?.stop();
  await adminStub?.stop();
  await env?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("X1-AC17 · thiếu cấu hình → thoát 1 trước đăng nhập", () => {
  it("X1-AC17 · thiếu DIFY_SEED_ENV_FILE → exit 1, nêu tên biến; admin (stub) 0 request", async () => {
    adminStub.reset();
    const r = await seed([], { DIFY_SEED_ENV_FILE: undefined, ADMIN_API_URL: adminStub.base });
    expect(r.code).toBe(1);
    expect(r.out).toContain("DIFY_SEED_ENV_FILE");
    expect(adminStub.calls).toHaveLength(0);
  }, 60_000);

  it("X1-AC17 · thiếu DIFY_KEY_TRANSLATE → exit 1, chỉ nêu tên biến (không key nào khác); admin 0 request", async () => {
    adminStub.reset();
    const f = writeEnv(".env.missing", ["DIFY_KEY_TRANSLATE"]);
    const r = await seed(["--apply"], { DIFY_SEED_ENV_FILE: f, ADMIN_API_URL: adminStub.base });
    expect(r.code).toBe(1);
    expect(r.out).toContain("DIFY_KEY_TRANSLATE");
    expect(leaksIn(r.out, Object.values(KEYS))).toEqual([]);
    expect(adminStub.calls).toHaveLength(0);
  }, 60_000);

  it("X1-AC17 · --apps foo → exit 1, lỗi nêu 'foo'; admin 0 request", async () => {
    adminStub.reset();
    const r = await seed(["--apps", "foo"], { ADMIN_API_URL: adminStub.base });
    expect(r.code).toBe(1);
    expect(r.out).toContain("foo");
    expect(adminStub.calls).toHaveLength(0);
  }, 60_000);
});

describe("X1-AC16 · dry-run → apply → idempotent → rotate", () => {
  it("X1-AC16 · dry-run (mặc định) → exit 0, in kế hoạch (tên workflow/command), KHÔNG ghi gì (audit, config_version, Hub 0 POST)", async () => {
    const a0 = await auditMax();
    const c0 = await cfg();
    hub.reset();
    const r = await seed([]);
    expect(r.code).toBe(0);
    for (const k of [...WF_KEYS, ...CMD_NAMES]) expect([k, r.out.includes(k)]).toEqual([k, true]);
    expect(await auditMax()).toBe(a0);
    expect(await cfg()).toBe(c0);
    expect(writes(hub)).toHaveLength(0);
    expect(await n("select count(*)::int as n from admin.workflows where key like 'dify-%'")).toBe(
      0,
    );
  }, 90_000);

  it("X1-AC16 · --apply lần 1 → 5 secret DIFY_KEY_*, 5 workflow dify-* (chatbot app_type agent, side_effect false, base_url = DIFY_API_URL), 4 command, feature + group dify-demo (lan), entitlement + grant, Hub POST grant dify-chatbot cho group", async () => {
    hub.reset();
    const r = await seed(["--apply"]);
    expect(r.code).toBe(0);
    const secrets = await env.owner<{ name: string }[]>`select name from admin.secrets
      where name like 'DIFY_KEY_%' order by name`;
    expect(secrets.map((s) => s.name)).toEqual(Object.values(ENV_KEY).sort());
    const wfs = await env.owner<
      { key: string; app_type: string; base_url: string; se: boolean | null }[]
    >`
      select key, app_type, base_url, (to_jsonb(w) ->> 'side_effect')::boolean as se
      from admin.workflows w where key like 'dify-%' order by key`;
    expect(wfs.map((w) => w.key)).toEqual(WF_KEYS);
    expect(wfs.find((w) => w.key === "dify-chatbot")?.app_type).toBe("agent");
    expect(wfs.every((w) => w.se === false)).toBe(true);
    expect(wfs.every((w) => w.base_url === difyUrl)).toBe(true);
    const cmds = await env.owner<{ name: string }[]>`select c.name from admin.commands c
      join admin.workflows w on w.id = c.workflow_id where w.key like 'dify-%' order by c.name`;
    expect(cmds.map((c) => c.name)).toEqual(CMD_NAMES);
    const [g] = await env.owner<{ id: string }[]>`select id from admin.groups
      where tenant_id = ${TENANT_ID.acme} and key = 'dify-demo'`;
    expect(Boolean(g?.id)).toBe(true);
    expect(
      await n(
        `select count(*)::int as n from admin.group_members where group_id = '${g?.id}' and user_id = '${USER_ID.lan}'`,
      ),
    ).toBe(1);
    expect(
      await n(`select count(*)::int as n from admin.feature_grants fg join admin.features f on f.id = fg.feature_id
        where f.key = 'dify-demo' and fg.group_id = '${g?.id}'`),
    ).toBe(1);
    expect(
      await n(`select count(*)::int as n from admin.feature_entitlements e join admin.features f on f.id = e.feature_id
        where f.key = 'dify-demo' and e.tenant_id = '${TENANT_ID.acme}' and e.revoked_at is null`),
    ).toBe(1);
    const posts = hub.calls.filter((c) => c.method === "POST" && c.path === "/agent-grants");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0]?.body ?? "{}")).toEqual({
      agent_id: AGENT_ID,
      subject_type: "group",
      subject_id: g?.id,
    });
    expect(await n("select count(*)::int as n from hub.agents where key = 'dify-chatbot'")).toBe(1);
  }, 120_000);

  it("X1-AC16 · X1-R14 · --apply lần 2 → idempotent: 0 dòng audit mới, config_version không đổi, không DELETE nào tới Hub", async () => {
    const a0 = await auditMax();
    const c0 = await cfg();
    hub.reset();
    const r = await seed(["--apply"]);
    expect(r.code).toBe(0);
    expect(await auditMax()).toBe(a0);
    expect(await cfg()).toBe(c0);
    expect(hub.calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
  }, 120_000);

  it("X1-AC16 · --apply --rotate-secrets → 5 audit secret/update, không audit delete nào trong cả kịch bản", async () => {
    const a0 = await auditMax();
    const r = await seed(["--apply", "--rotate-secrets"]);
    expect(r.code).toBe(0);
    expect(
      await n(
        `select count(*)::int as n from admin.audit_log where seq > ${a0} and entity = 'secret' and action = 'update'`,
      ),
    ).toBe(5);
    expect(await n("select count(*)::int as n from admin.audit_log where action = 'delete'")).toBe(
      0,
    );
  }, 120_000);
});

describe("X1-AC16 · X1-R01..R04 · không gọi Dify, không lộ key", () => {
  it("X1-AC16 · X1-R01/R02 · Dify stub 0 lời gọi suốt kịch bản (không /info, /parameters, /console/api)", () => {
    expect(outputs.length).toBeGreaterThanOrEqual(4);
    expect(dify.calls.map((c) => `${c.method} ${c.path}`)).toEqual([]);
  });

  it("X1-AC16 · X1-R04 · stdout/stderr seed + log admin-api + dump DB không chứa key (thô/base64/base64url/hex), không tiền tố key; biến console/agent không bị đọc", async () => {
    const all = `${outputs.join("\n")}\n${api.output()}`;
    expect(leaksIn(all, Object.values(KEYS))).toEqual([]);
    expect(all).not.toContain("QCFAKE");
    expect(leaksIn(all, Object.values(TRAP))).toEqual([]);
    const forms = Object.values(KEYS).flatMap((k) => [k, Buffer.from(k).toString("base64")]);
    expect(await scanDatabase(env.owner, forms)).toEqual([]);
  });
});
