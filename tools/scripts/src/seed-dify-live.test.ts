// ADM-FR-21 · X1-R01..R05, R14 · unit `seed:dify`: `.env` giả trong thư mục tạm (key giả sinh lúc chạy) + admin giả
// (`Bun.serve`). Không gọi Dify, không đọc file env thật nào.
import { afterAll, afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "./seed-dify-live";
import { overlayYaml } from "./seed-dify-live.hub-seed";
import {
  buildSeedPlan,
  canonical,
  ENV_KEY,
  parseSeedArgs,
  parseSeedEnv,
  SEED_APPS,
  type SeedArgs,
  workflowPatch,
} from "./seed-dify-live.rules";

/** Key giả ghép lúc chạy (file không chứa chuỗi giống key — AC18). */
const fakeKey = () => ["app", `UNIT${randomBytes(16).toString("hex")}`].join("-");
const KEYS = Object.fromEntries(SEED_APPS.map((a) => [a, fakeKey()])) as Record<string, string>;
let dir = "";
let envFile = "";
let calls: string[] = [];
let server: ReturnType<typeof Bun.serve>;

function envText(skip: string[] = []): string {
  const lines = [
    'DIFY_API_URL="http://127.0.0.1:9/v1"',
    "DIFY_CONSOLE_PASSWORD=trap-console-value",
  ];
  for (const a of SEED_APPS)
    if (!skip.includes(ENV_KEY[a])) lines.push(`export ${ENV_KEY[a]}=${KEYS[a]}`);
  return `${lines.join("\n")}\n`;
}

async function run(argv: string[], env: Record<string, string | undefined>) {
  const out: string[] = [];
  const log = spyOn(console, "log").mockImplementation(
    (...a: unknown[]) => void out.push(a.join(" ")),
  );
  const err = spyOn(console, "error").mockImplementation(
    (...a: unknown[]) => void out.push(a.join(" ")),
  );
  try {
    const code = await main(argv, env);
    return { code, out: out.join("\n") };
  } finally {
    log.mockRestore();
    err.mockRestore();
  }
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "seed-dify-unit-"));
  envFile = join(dir, ".env");
  writeFileSync(envFile, envText());
  // Admin giả: đăng nhập OK, list rỗng, mọi POST trả 500 kèm NGUYÊN body (kiểm script không in body lỗi).
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      calls.push(`${req.method} ${u.pathname}`);
      if (u.pathname === "/auth/login")
        return Response.json({ status: "authenticated", access_token: "tok" });
      if (u.pathname === "/admin/tenants")
        return Response.json({ items: [{ id: "t-1", key: "acme" }], total: 1 });
      if (req.method === "GET") return Response.json({ items: [], total: 0 });
      if (u.pathname === "/admin/groups") return Response.json({ id: "g-1" }, { status: 201 });
      if (u.pathname.endsWith("/members"))
        return Response.json({ added: ["lan"], not_found: [], already: [] });
      const body = await req.text();
      return Response.json({ error: { code: "BOOM", message: body } }, { status: 500 });
    },
  });
});
afterEach(() => {
  calls = [];
});
afterAll(() => {
  server?.stop(true);
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("parseSeedEnv / parseSeedArgs", () => {
  it("bỏ ngoặc + `export`; chỉ giữ biến trong danh sách trắng", () => {
    const r = parseSeedEnv(envText(), ["translate"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.apiUrl).toBe("http://127.0.0.1:9/v1");
    expect([...r.keys.entries()]).toEqual([["translate", KEYS.translate as string]]);
    expect(JSON.stringify([...r.keys.values()])).not.toContain("trap-console-value");
  });

  it("DIFY_API_URL không phải http(s) ⇒ missing; giá trị rỗng = thiếu", () => {
    const r = parseSeedEnv(`DIFY_API_URL=ftp://x\nDIFY_KEY_TRANSLATE=\n`, ["translate"]);
    expect(r).toEqual({ ok: false, missing: ["DIFY_API_URL", "DIFY_KEY_TRANSLATE"] });
  });

  it("--apps=a,b theo thứ tự SEED_APPS; cờ lạ / tenant sai ⇒ lỗi", () => {
    expect((parseSeedArgs(["--apps=translate,chatbot"]) as SeedArgs).apps).toEqual([
      "chatbot",
      "translate",
    ]);
    expect(parseSeedArgs(["--force"])).toEqual({ error: "cờ không hỗ trợ: --force" });
    expect("error" in parseSeedArgs(["--tenant", "Bad Key"])).toBe(true);
    expect("error" in parseSeedArgs(["--apps", ""])).toBe(true);
  });
});

describe("CR-051 · --members + alias /dich", () => {
  it("--members thay thành viên group (mặc định lan); username sai ⇒ lỗi", () => {
    expect((parseSeedArgs([]) as SeedArgs).members).toEqual(["lan"]);
    const a = parseSeedArgs([
      "--tenant",
      "evolu",
      "--members",
      "julian.bui, thomas.tran",
    ]) as SeedArgs;
    expect(a.members).toEqual(["julian.bui", "thomas.tran"]);
    expect(buildSeedPlan(a, "http://x/v1").group.members).toEqual(["julian.bui", "thomas.tran"]);
    expect("error" in parseSeedArgs(["--members", "a@b"])).toBe(true);
    expect("error" in parseSeedArgs(["--members="])).toBe(true);
  });
  it("lệnh translate có alias dich", () => {
    const p = buildSeedPlan(parseSeedArgs(["--apps", "translate"]) as SeedArgs, "http://x/v1");
    expect(p.commands.find((c) => c.name === "translate")?.aliases).toEqual(["dich"]);
  });
});

describe("plan / patch", () => {
  it("không chọn chatbot ⇒ không agent; chatbot có input `query` (Hub dify-agent cần input nhận tin)", () => {
    const a = parseSeedArgs(["--apps", "translate"]) as SeedArgs;
    expect(buildSeedPlan(a, "http://x/v1").agent).toBeNull();
    const p = buildSeedPlan(parseSeedArgs([]) as SeedArgs, "http://x/v1");
    const chat = p.workflows.find((w) => w.key === "dify-chatbot");
    expect(chat?.input_schema.map((i) => i.name)).toEqual(["query"]);
    expect(p.workflows.every((w) => w.side_effect === false)).toBe(true);
  });

  it("so sánh không phụ thuộc thứ tự khoá; null ≡ vắng", () => {
    expect(canonical({ b: 1, a: [{ y: 2, x: 1 }] })).toBe(canonical({ a: [{ x: 1, y: 2 }], b: 1 }));
    expect(workflowPatch({ output_field: undefined }, { output_field: null })).toBeNull();
    expect(workflowPatch({ key: "a" }, { key: "b" })).toBeNull(); // key bất biến, không patch
  });

  it("overlay Hub: agent dify-agent + entitlement tenant, không grants", () => {
    const doc = Bun.YAML.parse(overlayYaml("acme")) as Record<string, unknown[]>;
    expect(doc.agents?.[0]).toMatchObject({
      key: "dify-chatbot",
      runtime: "dify-agent",
      runtime_options: { workflow_key: "dify-chatbot" },
    });
    expect(doc.entitlements).toEqual([{ agent: "dify-chatbot", tenant_key: "acme" }]);
    expect(doc.grants).toBeUndefined();
  });
});

describe("CLI main", () => {
  const base = () => ({ DIFY_SEED_ENV_FILE: envFile, ADMIN_API_URL: server.url.href });

  it("dry-run: exit 0, in kế hoạch, 0 lời gọi mạng, không key", async () => {
    const r = await run([], base());
    expect(r.code).toBe(0);
    expect(r.out).toContain("DRY-RUN");
    expect(r.out).toContain("/ask-image");
    expect(calls).toEqual([]);
    for (const k of Object.values(KEYS)) expect(r.out).not.toContain(k);
  });

  it("thiếu DIFY_SEED_ENV_FILE / thiếu key ⇒ exit 1 nêu tên biến, 0 lời gọi", async () => {
    expect((await run([], { ADMIN_API_URL: server.url.href })).out).toContain("DIFY_SEED_ENV_FILE");
    const f = join(dir, ".env.miss");
    writeFileSync(f, envText(["DIFY_KEY_GMAIL"]));
    const r = await run(["--apply"], { ...base(), DIFY_SEED_ENV_FILE: f });
    expect(r.code).toBe(1);
    expect(r.out).toContain("DIFY_KEY_GMAIL");
    expect(calls).toEqual([]);
  });

  it("--apply thiếu tài khoản admin ⇒ exit 1 trước mọi lời gọi", async () => {
    const r = await run(["--apply"], base());
    expect(r.code).toBe(1);
    expect(r.out).toContain("SEED_ADMIN_USERNAME");
    expect(calls).toEqual([]);
  });

  it("--apply: admin trả lỗi kèm body ⇒ chỉ in bước + mã, không lộ key", async () => {
    const env = { ...base(), SEED_ADMIN_USERNAME: "admin", SEED_ADMIN_PASSWORD: "pw-unit-test" };
    const r = await run(["--apply", "--apps", "translate"], env);
    expect(r.code).toBe(1);
    expect(r.out).toContain("Lỗi bước secret DIFY_KEY_TRANSLATE: HTTP 500 BOOM");
    expect(calls).toContain("POST /admin/secrets");
    expect(r.out).not.toContain(KEYS.translate as string);
    expect(r.out).not.toContain("pw-unit-test");
  });
});
