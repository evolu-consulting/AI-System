// ADM-FR-50, ADM-NFR-01, ADM-NFR-06, ADM-BR-04 · admin-api thật (spawn, cổng 3093) với SECRET_MASTER_KEY:
// khởi động, log không rò, không có route giải mã (test-plan SP; AC-A06).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { newMasterKeyB64 } from "./_crypto";
import { LEAK_1, LEAK_2, LEAK_SHORT, leakForms } from "./_data";
import { ADMIN_API_URL, createM2Env, type M2Env, SEED_PW, scanDatabase } from "./_fixtures";
import { ROOT } from "./_modules";

const PORT = 3093;
const BASE = `http://localhost:${PORT}`;
const DEADLINE_MS = 20_000;
const KEY = newMasterKeyB64();
const KEY_OTHER = newMasterKeyB64();
let env: M2Env;
let TOKEN = "";

beforeAll(async () => {
  env = await createM2Env();
});
afterAll(async () => {
  await env.close();
});

type Spawned = { proc: ReturnType<typeof Bun.spawn>; output: () => Promise<string> };

function baseEnv(over: Record<string, string | undefined>): Record<string, string> {
  const merged: Record<string, string | undefined> = {
    ...process.env,
    PORT: String(PORT),
    APP_ENV: "test",
    CORS_ORIGINS: "http://localhost:3000",
    ADMIN_API_DATABASE_URL: ADMIN_API_URL,
    SECRET_MASTER_KEY: KEY,
    ...over,
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(merged)) if (v !== undefined) out[k] = v;
  return out;
}

function spawnServer(over: Record<string, string | undefined> = {}): Spawned {
  const proc = Bun.spawn(["bun", "apps/admin-api/src/server.ts"], {
    cwd: ROOT,
    env: baseEnv(over),
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = new Response(proc.stdout as ReadableStream).text();
  const err = new Response(proc.stderr as ReadableStream).text();
  return { proc, output: async () => `${await out}${await err}` };
}

async function waitHealthy(): Promise<void> {
  const deadline = Date.now() + DEADLINE_MS;
  while (Date.now() < deadline) {
    if ((await fetch(`${BASE}/health`).catch(() => null))?.status === 200) return;
    await Bun.sleep(100);
  }
  throw new Error("admin-api không lắng nghe /health trong hạn chót");
}

async function exitCode(p: Spawned): Promise<number | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((r) => {
    timer = setTimeout(() => r(null), DEADLINE_MS);
  });
  try {
    const code = await Promise.race([p.proc.exited, timeout]);
    if (code === null) p.proc.kill();
    return code;
  } finally {
    clearTimeout(timer);
  }
}

/** Chạy server, gọi `fn`, luôn dừng; trả toàn bộ stdout+stderr. */
async function withServer(
  fn: (call: (method: string, path: string, body?: unknown) => Promise<Response>) => Promise<void>,
  over: Record<string, string | undefined> = {},
): Promise<string> {
  const p = spawnServer(over);
  try {
    await waitHealthy();
    const login = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenant_key: "platform", username: "admin", password: SEED_PW }),
    });
    const grant = (await login.json()) as { access_token: string };
    TOKEN = grant.access_token;
    await fn((method, path, body) =>
      fetch(`${BASE}${path}`, {
        method,
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  } finally {
    p.proc.kill();
    await p.proc.exited;
  }
  return p.output();
}
async function mustRefuse(over: Record<string, string | undefined>, bad: string | null) {
  const p = spawnServer(over);
  const code = await exitCode(p);
  const out = await p.output();
  expect(code).not.toBeNull();
  expect(code).not.toBe(0);
  expect(out).toContain("SECRET_MASTER_KEY");
  if (bad) expect(out).not.toContain(bad);
  expect(await fetch(`${BASE}/health`).catch(() => null)).toBeNull();
}

describe("ADM-NFR-06 · khởi động với SECRET_MASTER_KEY", () => {
  it("ADM-FR-50 · M2-R02 · thiếu SECRET_MASTER_KEY → thoát ≠ 0, nêu đúng tên biến, không lắng nghe", async () => {
    await mustRefuse({ SECRET_MASTER_KEY: undefined }, null);
  });

  it("ADM-FR-50 · M2-R02 · sai định dạng (31 byte, 33 byte, 44 ký tự có '=', url-safe, có khoảng trắng, chuỗi bậy) → thoát ≠ 0, nêu tên biến, KHÔNG in giá trị đã đặt", async () => {
    const b31 = randomBytes(31).toString("base64");
    const b33 = randomBytes(33).toString("base64");
    const urlSafe = Buffer.alloc(32, 0xfb)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    const spaced = `${KEY.slice(0, 20)} ${KEY.slice(20)}`;
    for (const bad of [b31, b33, `${KEY}=`, urlSafe, spaced, "KEY-MARKER-NOT-BASE64-9f3a1"]) {
      await mustRefuse({ SECRET_MASTER_KEY: bad }, bad);
    }
  });

  it("ADM-FR-50 · M2-R02 · khoá hợp lệ → /health 200; đăng nhập admin seed + POST /admin/secrets qua HTTP thật → 201", async () => {
    await withServer(async (call) => {
      const res = await call("POST", "/admin/secrets", { name: "DIFY_PROC_KEY", value: LEAK_1 });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { name: string; last4: string };
      expect(body).toMatchObject({ name: "DIFY_PROC_KEY", last4: LEAK_1.slice(-4) });
    });
  });
});

describe("ADM-BR-04 · AC-A06 · log và route", () => {
  it("AC-A06 · ADM-NFR-01 · stdout+stderr sau tạo/thay/sửa ghi chú/xoá/400/409/404/403 không chứa LEAK_*, khoá chủ, token, header Authorization, bản mã", async () => {
    let seenToken = "";
    const out = await withServer(async (call) => {
      seenToken = TOKEN;
      await call("POST", "/admin/secrets", {
        name: "DIFY_LOG_KEY",
        value: LEAK_1,
        note: "ghi chú",
      });
      await call("POST", "/admin/secrets", { name: "DIFY_LOG_KEY", value: LEAK_1 });
      await call("POST", "/admin/secrets", { name: "DIFY_LOG_KEY2", value: LEAK_SHORT });
      await call("PUT", "/admin/secrets/DIFY_LOG_KEY", { value: LEAK_2 });
      await call("PATCH", "/admin/secrets/DIFY_LOG_KEY", { note: "mới" });
      await call("PUT", "/admin/secrets/DIFY_KHONG_CO", { value: LEAK_2 });
      await call("GET", "/admin/secrets");
      await call("DELETE", "/admin/secrets/DIFY_LOG_KEY");
      const as403 = await fetch(`${BASE}/admin/secrets`, {
        headers: { authorization: "Bearer khong.phai.token" },
      });
      expect(as403.status).toBe(401);
    });
    const [ct] = await env.owner`select ciphertext from admin.secrets limit 1`;
    const forbidden = [
      ...leakForms(LEAK_1),
      ...leakForms(LEAK_2),
      KEY,
      seenToken,
      `Bearer ${seenToken}`,
      ...(ct ? [Buffer.from(ct.ciphertext).toString("base64")] : []),
    ];
    expect(forbidden.filter((f) => f && out.includes(f))).toEqual([]);
    expect(out.toLowerCase()).not.toContain("authorization");
  });

  it("ADM-BR-04 · M2-R03 · dòng log request của /admin/secrets* chỉ có method/path/status (không body, không header, không query)", async () => {
    const out = await withServer(async (call) => {
      await call("POST", "/admin/secrets", { name: "DIFY_LINE_KEY", value: LEAK_1 });
      await call("GET", "/admin/secrets?q=QUERY-MARKER-91");
    });
    const lines = out.split(/\r?\n/).filter((l) => l.includes("/admin/secrets"));
    expect(lines.length).toBeGreaterThanOrEqual(1);
    for (const l of lines) {
      expect(l).not.toContain("QUERY-MARKER-91");
      expect(l).not.toContain(LEAK_1);
      expect(l.toLowerCase()).not.toContain("authorization");
    }
  });

  it("ADM-BR-04 · M2-R03 · khởi động lại với khoá KHÁC: GET vẫn 200 (không giải mã), PUT ghi bản mã mới; không có route giải mã (GET /:name, /value, /reveal, /export → 404)", async () => {
    await withServer(async (call) => {
      const res = await call("POST", "/admin/secrets", { name: "DIFY_ROT_KEY", value: LEAK_1 });
      expect(res.status).toBe(201);
    });
    await withServer(
      async (call) => {
        expect((await call("GET", "/admin/secrets")).status).toBe(200);
        const put = await call("PUT", "/admin/secrets/DIFY_ROT_KEY", { value: LEAK_2 });
        expect(put.status).toBe(200);
        for (const path of [
          "/admin/secrets/DIFY_ROT_KEY",
          "/admin/secrets/DIFY_ROT_KEY/value",
          "/admin/secrets/DIFY_ROT_KEY/reveal",
          "/admin/secrets/export",
        ]) {
          expect((await call("GET", path)).status).toBe(404);
        }
      },
      { SECRET_MASTER_KEY: KEY_OTHER },
    );
  });

  it("ADM-FR-12 · ADM-FR-20 · M2 không làm FR-12/FR-23: không có POST /admin/commands/:id/test, /admin/workflows/:id/test-connection, /admin/workflows/:id/dify-schema (404)", async () => {
    await withServer(async (call) => {
      const id = "01900000-0000-7000-8000-0000000002f9";
      for (const path of [
        `/admin/commands/${id}/test`,
        `/admin/workflows/${id}/test-connection`,
        `/admin/workflows/${id}/dify-schema`,
      ]) {
        expect((await call("POST", path, {})).status).toBe(404);
      }
    });
  });

  it("AC-A06 · ADM-BR-04 · quét toàn DB (mọi bảng admin.* và hub.* bằng row_to_json): không chứa LEAK_1/LEAK_2 dạng thô, base64, hex", async () => {
    const hits = await scanDatabase(env.owner, [...leakForms(LEAK_1), ...leakForms(LEAK_2)]);
    expect(hits).toEqual([]);
    const [n] = await env.owner`select count(*)::int as n from admin.secrets`;
    expect(n?.n).toBeGreaterThan(0);
  });

  it("ADM-NFR-06 · SIGTERM → tiến trình thoát trong hạn chót (không treo kết nối)", async () => {
    const p = spawnServer();
    await waitHealthy();
    p.proc.kill("SIGTERM");
    expect(await exitCode(p)).not.toBeNull();
  });
});
