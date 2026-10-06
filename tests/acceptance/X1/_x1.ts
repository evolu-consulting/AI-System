// X1-AC11, AC14, AC16 · hạ tầng int X1 (test-plan §2, P1): admin-api thật chạy như tiến trình (`bun apps/admin-api/src/server.ts`)
// với env riêng để quét stdout/stderr; stub HTTP (Hub, Dify) bằng `Bun.serve` ghi request. Không chứa `it(...)`.
// Token/key giả sinh LÚC CHẠY (không commit chuỗi giống key, AC18). Không đọc `.env` của auto-pilot.
import { randomBytes } from "node:crypto";
import { ROOT } from "./_modules";

export { ROOT };

/** Chuỗi ngẫu nhiên base64url, `n` ký tự (vd token 48 ký tự như `combine:dev`). */
export const randomToken = (n = 48): string =>
  randomBytes(Math.ceil((n * 3) / 4) + 2)
    .toString("base64url")
    .slice(0, n);

/** Key Dify giả dạng `app-…` sinh lúc chạy (P1). */
export const fakeDifyKey = (): string => `app-${"QCFAKE".repeat(2)}${randomToken(20)}`;

/** Mọi dạng mã hoá cần quét rò: thô, base64 (có/không `=`), base64url, hex thường/hoa (mẫu H2a `leakForms`). */
export function leakForms(secret: string): string[] {
  const b = Buffer.from(secret, "utf8");
  const b64 = b.toString("base64");
  return [
    secret,
    b64,
    b64.replace(/=+$/, ""),
    b.toString("base64url"),
    b.toString("hex"),
    b.toString("hex").toUpperCase(),
  ];
}

/** Các dạng của `secrets` có trong `text` (rỗng = không lộ). */
export function leaksIn(text: string, secrets: string[]): string[] {
  return secrets.flatMap((s) => leakForms(s)).filter((f) => f.length > 0 && text.includes(f));
}

// ---------- admin-api như tiến trình ----------
export type Proc = {
  base: string;
  proc: ReturnType<typeof Bun.spawn>;
  /** stdout+stderr đã ghi tới lúc gọi (đọc liên tục, không chờ thoát). */
  output: () => string;
  stop: () => Promise<string>;
};

function mergeEnv(over: Record<string, string | undefined>): Record<string, string> {
  const merged: Record<string, string | undefined> = { ...process.env, ...over };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(merged)) if (v !== undefined) out[k] = v;
  return out;
}

function pump(stream: ReadableStream<Uint8Array>, sink: string[]): void {
  const dec = new TextDecoder();
  void (async () => {
    for await (const chunk of stream) sink.push(dec.decode(chunk, { stream: true }));
  })().catch(() => {});
}

/** Chạy `bun <entry>` ở gốc repo với env (`undefined` = xoá biến kế thừa). */
export function spawnProc(
  entry: string,
  port: number,
  over: Record<string, string | undefined>,
): Proc {
  const proc = Bun.spawn(["bun", entry], {
    cwd: ROOT,
    env: mergeEnv(over),
    stdout: "pipe",
    stderr: "pipe",
  });
  const chunks: string[] = [];
  pump(proc.stdout as ReadableStream<Uint8Array>, chunks);
  pump(proc.stderr as ReadableStream<Uint8Array>, chunks);
  return {
    base: `http://localhost:${port}`,
    proc,
    output: () => chunks.join(""),
    stop: async () => {
      proc.kill();
      await proc.exited;
      await Bun.sleep(0);
      return chunks.join("");
    },
  };
}

/** Chờ `GET /health` 200 hoặc tiến trình thoát; trả status cuối (0 = không lắng nghe). */
export async function waitHealth(p: Proc, ms = 20_000): Promise<number> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const st = await fetch(`${p.base}/health`, { signal: AbortSignal.timeout(1_000) })
      .then((r) => r.status)
      .catch(() => 0);
    if (st === 200 || p.proc.exitCode !== null) return st;
    await Bun.sleep(100);
  }
  return 0;
}

/** Chờ tiến trình thoát trong `ms`; quá hạn ⇒ kill, trả null. */
export async function exitWithin(p: Proc, ms: number): Promise<number | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<null>((r) => {
    timer = setTimeout(() => r(null), ms);
  });
  try {
    const code = await Promise.race([p.proc.exited, t]);
    if (code === null) {
      p.proc.kill();
      await p.proc.exited;
    }
    return code;
  } finally {
    clearTimeout(timer);
  }
}

/** Env tối thiểu cho admin-api thật trên DB test (mẫu `M2/secrets-proc`). */
export function adminEnv(
  port: number,
  dbUrl: string,
  masterKeyB64: string,
  over: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    PORT: String(port),
    APP_ENV: "test",
    CORS_ORIGINS: "http://localhost:3000",
    ADMIN_API_DATABASE_URL: dbUrl,
    SECRET_MASTER_KEY: masterKeyB64,
    ADMIN_HUB_URL: undefined,
    HUB_INTERNAL_TOKEN: undefined,
    ...over,
  };
}

export async function loginProc(
  base: string,
  tenant_key: string,
  username: string,
  password: string,
): Promise<{ token: string; sub: string }> {
  const res = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenant_key, username, password }),
  });
  if (res.status !== 200) throw new Error(`login ${tenant_key}/${username} → ${res.status}`);
  const token = ((await res.json()) as { access_token: string }).access_token;
  const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString());
  return { token, sub: String(payload.sub) };
}

// ---------- stub HTTP ghi request ----------
export type Recorded = {
  method: string;
  path: string;
  query: string;
  headers: Record<string, string>;
  body: string;
  aborted: boolean;
};
export type Stub = {
  base: string;
  port: number;
  calls: Recorded[];
  reset: () => void;
  stop: () => Promise<void>;
};

/** `handler` trả Response (hoặc Promise); request được ghi trước khi gọi handler. `signal` báo huỷ phía client. */
export function startStub(
  handler: (rec: Recorded, req: Request) => Response | Promise<Response>,
): Stub {
  const calls: Recorded[] = [];
  const server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    async fetch(req) {
      const u = new URL(req.url);
      const rec: Recorded = {
        method: req.method,
        path: u.pathname,
        query: u.search,
        headers: Object.fromEntries(req.headers.entries()),
        body: await req.text(),
        aborted: false,
      };
      req.signal.addEventListener("abort", () => {
        rec.aborted = true;
      });
      calls.push(rec);
      return handler(rec, req);
    },
  });
  return {
    base: `http://127.0.0.1:${server.port}`,
    port: server.port as number,
    calls,
    reset: () => {
      calls.length = 0;
    },
    stop: async () => {
      await server.stop(true);
    },
  };
}

export const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Chờ điều kiện (không `sleep` cố định). */
export async function until(ok: () => boolean, ms = 5_000): Promise<boolean> {
  const end = Date.now() + ms;
  while (!ok() && Date.now() < end) await Bun.sleep(25);
  return ok();
}
