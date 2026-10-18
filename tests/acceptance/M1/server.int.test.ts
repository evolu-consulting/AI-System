// ADM-NFR-07, ADM-NFR-01, ADM-FR-01 · tiến trình admin-api thật (test-plan A8; cổng 3092).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  ADMIN_API_URL,
  createEnv,
  type Env,
  makeKeys,
  OWNER_URL,
  PW,
  withDangerRole,
} from "./_fixtures";
import { ROOT } from "./_modules";

const PORT = 3092;
const BASE = `http://localhost:${PORT}`;
const DEADLINE_MS = 20_000;
let env: Env;

beforeAll(async () => {
  env = await createEnv();
});
afterAll(async () => {
  await env.close();
});

type Proc = ReturnType<typeof Bun.spawn>;
/** `ready`: true khi log `listening`, false khi tiến trình thoát trước đó (chờ theo tín hiệu, không poll). */
type Spawned = { proc: Proc; output: () => Promise<string>; ready: Promise<boolean> };

function baseEnv(over: Record<string, string | undefined> = {}): Record<string, string> {
  const merged: Record<string, string | undefined> = {
    ...process.env,
    PORT: String(PORT),
    APP_ENV: "test",
    CORS_ORIGINS: "http://localhost:3000",
    ADMIN_API_DATABASE_URL: ADMIN_API_URL,
    ...env.keys.env,
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
  let text = "";
  let onReady: (v: boolean) => void = () => {};
  const ready = new Promise<boolean>((r) => {
    onReady = r;
  });
  const drain = async (s: ReadableStream<Uint8Array>) => {
    for await (const c of s) {
      text += new TextDecoder().decode(c);
      if (text.includes('"msg":"listening"')) onReady(true);
    }
  };
  const done = Promise.all([
    drain(proc.stdout as ReadableStream),
    drain(proc.stderr as ReadableStream),
  ]);
  void proc.exited.then(() => onReady(false));
  return {
    proc,
    ready,
    output: async () => {
      await done;
      return text;
    },
  };
}

/** Chờ log `listening` (hoặc tiến trình thoát ⇒ lỗi ngay kèm log); hạn chót chỉ là lưới an toàn. */
async function waitHealthy(p: Spawned): Promise<void> {
  const timer = new Promise<boolean>((r) => setTimeout(() => r(false), DEADLINE_MS));
  if (!(await Promise.race([p.ready, timer]))) {
    if (p.proc.exitCode === null) p.proc.kill();
    throw new Error(`admin-api không lắng nghe /health: ${(await p.output()).slice(0, 500)}`);
  }
  expect((await fetch(`${BASE}/health`)).status).toBe(200);
}

/** Chờ tiến trình tự thoát; hết hạn thì kill và trả null. */
async function exitCode(p: Spawned): Promise<number | null> {
  const timer = new Promise<null>((r) => setTimeout(() => r(null), DEADLINE_MS));
  const code = await Promise.race([p.proc.exited, timer]);
  if (code === null) p.proc.kill();
  return code;
}

async function mustExitWith(
  over: Record<string, string | undefined>,
  mention: string,
): Promise<string> {
  const p = spawnServer(over);
  const code = await exitCode(p);
  const out = await p.output();
  expect(code).not.toBeNull();
  expect(code).not.toBe(0);
  expect(out).toContain(mention);
  expect(await fetch(`${BASE}/health`).catch(() => null)).toBeNull();
  return out;
}

describe("ADM-FR-01 · server chạy thật", () => {
  it("ADM-FR-01 · M1-R01 · /health 200; đăng nhập thật qua HTTP rồi GET /auth/me bằng token → 200", async () => {
    const p = spawnServer();
    try {
      await waitHealthy(p);
      const login = await fetch(`${BASE}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenant_key: "acme", username: "an", password: PW }),
      });
      expect(login.status).toBe(200);
      const grant = (await login.json()) as { access_token: string };
      const me = await fetch(`${BASE}/auth/me`, {
        headers: { authorization: `Bearer ${grant.access_token}` },
      });
      expect(me.status).toBe(200);
    } finally {
      p.proc.kill();
      await p.proc.exited;
    }
  });
});

describe("ADM-NFR-07 · server từ chối role DB nguy hiểm", () => {
  it("ADM-NFR-07 · spec §4 · ADMIN_API_DATABASE_URL = owner/superuser → thoát ≠ 0, nhắc ADMIN_API_DATABASE_URL, không lộ mật khẩu DB, không lắng nghe", async () => {
    const out = await mustExitWith({ ADMIN_API_DATABASE_URL: OWNER_URL }, "ADMIN_API_DATABASE_URL");
    const secret = new URL(OWNER_URL).password;
    if (secret) expect(out).not.toContain(secret);
  });

  it("ADM-NFR-07 · spec §4 · role có BYPASSRLS → thoát ≠ 0", async () => {
    await withDangerRole(env.owner, "bypass", async (url) => {
      await mustExitWith({ ADMIN_API_DATABASE_URL: url }, "ADMIN_API_DATABASE_URL");
    });
  });

  it("ADM-NFR-07 · spec §4 · role sở hữu bảng trong schema admin → thoát ≠ 0", async () => {
    await withDangerRole(env.owner, "owner", async (url) => {
      await mustExitWith({ ADMIN_API_DATABASE_URL: url }, "ADMIN_API_DATABASE_URL");
    });
  });
});

describe("ADM-NFR-01 · cấu hình thiếu/sai", () => {
  it("ADM-NFR-01 · spec §7 · thiếu ADMIN_API_DATABASE_URL hoặc JWT_PRIVATE_KEY → thoát ≠ 0, nêu tên biến, không in giá trị", async () => {
    await mustExitWith({ ADMIN_API_DATABASE_URL: undefined }, "ADMIN_API_DATABASE_URL");
    const out = await mustExitWith({ JWT_PRIVATE_KEY: undefined }, "JWT_PRIVATE_KEY");
    expect(out).not.toContain(env.keys.publicPem.split("\n")[1] ?? "<none>");
  });

  it("ADM-NFR-01 · spec §7 · cặp khoá lệch (public của cặp khác) → thoát ≠ 0", async () => {
    const other = makeKeys();
    const p = spawnServer({ JWT_PUBLIC_KEY: other.publicPem });
    const code = await exitCode(p);
    await p.output();
    expect(code).not.toBeNull();
    expect(code).not.toBe(0);
    expect(await fetch(`${BASE}/health`).catch(() => null)).toBeNull();
  });
});

describe("ADM-NFR-01 · log và CORS", () => {
  it("ADM-NFR-01 · M1-R17 · log không chứa mật khẩu, temp_password, access/refresh token, cookie, Authorization", async () => {
    const p = spawnServer();
    const secrets: string[] = [];
    try {
      await waitHealthy(p);
      const json = { "content-type": "application/json" };
      const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
        fetch(`${BASE}${path}`, {
          method: "POST",
          headers: { ...json, ...headers },
          body: JSON.stringify(body),
        });
      const marker = "Marker-Secret-Pw-7";
      await post("/auth/login", { tenant_key: "acme", username: "an", password: marker });
      const login = await post("/auth/login", {
        tenant_key: "acme",
        username: "binh",
        password: PW,
      });
      const grant = (await login.json()) as { access_token: string };
      const cookie = /^ai_rt=([^;]+)/.exec(login.headers.get("set-cookie") ?? "")?.[1] ?? "";
      const created = await post(
        "/admin/users",
        { username: "nam", display_name: "Nam", role: "member" },
        { authorization: `Bearer ${grant.access_token}` },
      );
      const temp = ((await created.json()) as { temp_password: string }).temp_password;
      await fetch(`${BASE}/auth/refresh`, {
        method: "POST",
        headers: { cookie: `ai_rt=${cookie}` },
      });
      secrets.push(marker, PW, temp, grant.access_token, cookie);
    } finally {
      p.proc.kill();
      await p.proc.exited;
    }
    await p.proc.exited;
    const out = await p.output();
    expect(out.length).toBeGreaterThan(0);
    for (const s of secrets) {
      expect(s.length).toBeGreaterThan(8);
      expect(out).not.toContain(s);
    }
    expect(out.toLowerCase()).not.toContain("bearer ey");
  });

  it("ADM-FR-01 · spec §3 · CORS: preflight cho phép Content-Type, Authorization, X-Client, X-Request-Id + credentials; origin lạ bị từ chối", async () => {
    const p = spawnServer();
    try {
      await waitHealthy(p);
      const pre = (origin: string) =>
        fetch(`${BASE}/auth/login`, {
          method: "OPTIONS",
          headers: {
            origin,
            "access-control-request-method": "POST",
            "access-control-request-headers": "content-type,authorization,x-client,x-request-id",
          },
        });
      const ok = await pre("http://localhost:3000");
      const allowed = (ok.headers.get("access-control-allow-headers") ?? "").toLowerCase();
      for (const h of ["content-type", "authorization", "x-client", "x-request-id"]) {
        expect(allowed).toContain(h);
      }
      expect(ok.headers.get("access-control-allow-credentials")).toBe("true");
      expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
      const evil = await pre("http://evil.example");
      expect(evil.headers.get("access-control-allow-origin")).not.toBe("http://evil.example");
    } finally {
      p.proc.kill();
      await p.proc.exited;
    }
  });
});
