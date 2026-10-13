// HUB-FR-131 · HUB-FR-132 · HUB-BR-40 · plan K1 §3.2, D5, D9 · unit `KhClient` + `KhProjectsCache` (KH giả Bun.serve cổng 0).
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { SecretUseError } from "../secrets/secrets.use";
import { KhCallError, KhClient, type KhConn, KhProjectsCache } from "./kh.client";

const KEY = "unit-kh-key";
type Seen = { path: string; key: string | null; body: unknown };
const seen: Seen[] = [];
let mode: "ok" | "slow" | "500" | "html" = "ok";

const server = Bun.serve({
  port: 0,
  idleTimeout: 0,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    const body = req.method === "POST" ? await req.json() : null;
    seen.push({ path, key: req.headers.get("x-kh-key"), body });
    if (mode === "slow") await Bun.sleep(300);
    if (mode === "500") return Response.json({ detail: "boom" }, { status: 500 });
    if (mode === "html")
      return new Response("<html>", { headers: { "content-type": "text/html" } });
    if (path === "/redirect") return Response.redirect("http://example.com/", 302);
    if (path !== "/health" && req.headers.get("x-kh-key") !== KEY)
      return Response.json({ detail: "missing or invalid API key" }, { status: 401 });
    if (path === "/projects") return Response.json({ projects: { b: {}, a: {}, "bad id": {} } });
    return Response.json({ ok: true, path });
  },
});
afterAll(() => server.stop(true));

const origin = `http://localhost:${server.port}`;
const conn: KhConn = { id: "c1", baseUrl: origin, secretId: "s1", version: 1 };
let keyValue: string | null = KEY;
const secrets = {
  useSecret: <T>(_ref: unknown, fn: (v: string) => Promise<T>): Promise<T> =>
    keyValue === null ? Promise.reject(new SecretUseError("secret_missing")) : fn(keyValue),
};
const client = (timeoutMs = 1000, allowed = [origin]) =>
  new KhClient({ secrets, cfg: { allowedOrigins: allowed, timeoutMs }, dev: true });

async function err(p: Promise<unknown>): Promise<KhCallError> {
  try {
    await p;
  } catch (x) {
    return x as KhCallError;
  }
  throw new Error("expected KhCallError");
}

beforeEach(() => {
  seen.length = 0;
  mode = "ok";
  keyValue = KEY;
});

describe("HUB-FR-131 · KhClient", () => {
  test("có khoá ⇒ header X-KH-Key; key:false ⇒ không header", async () => {
    const c = client();
    expect(await c.get(conn, "/version")).toEqual({ ok: true, path: "/version" });
    expect(await c.hit(conn, "GET", "/version", { key: false })).toMatchObject({ status: 401 });
    expect(seen.map((s) => s.key)).toEqual([KEY, null]);
  });

  test("POST query gửi k=8, max_chars=1500", async () => {
    await client().query(conn, { text: "q", project: "p" });
    expect(seen[0]).toMatchObject({
      path: "/vector/query",
      body: { text: "q", project: "p", k: 8, max_chars: 1500 },
    });
  });

  test("URL ngoài allowlist ⇒ disabled, không gọi KH", async () => {
    const e = await err(client(1000, ["https://kh.example.com"]).get(conn, "/version"));
    expect(e).toBeInstanceOf(KhCallError);
    expect(e.code).toBe("disabled");
    expect(seen).toHaveLength(0);
  });

  test("redirect bị chặn ⇒ unreachable", async () => {
    const e = await err(client().get(conn, "/redirect"));
    expect(e.code).toBe("unreachable");
  });

  test("hết giờ ⇒ timeout; hit thô ⇒ 'timeout'", async () => {
    mode = "slow";
    expect(await client(50).hit(conn, "GET", "/health", { key: false })).toBe("timeout");
    const e = await err(client(50).get(conn, "/version"));
    expect(e.code).toBe("timeout");
  });

  test("deadline ngoài huỷ ⇒ timeout", async () => {
    mode = "slow";
    const h = await client(5000).hit(conn, "GET", "/health", {
      key: false,
      signal: AbortSignal.timeout(30),
    });
    expect(h).toBe("timeout");
  });

  test("5xx ⇒ server_error {status}; 401 ⇒ unauthorized; message cố định không khoá", async () => {
    mode = "500";
    const e = await err(client().get(conn, "/version"));
    expect([e.code, e.status, e.message]).toEqual(["server_error", 500, "kh: server_error"]);
    mode = "ok";
    keyValue = "wrong";
    const u = await err(client().get(conn, "/version"));
    expect([u.code, u.status]).toEqual(["unauthorized", 401]);
    expect(u.message).not.toContain("wrong");
  });

  test("thân không phải JSON ⇒ body null; projects ⇒ invalid", async () => {
    mode = "html";
    expect(await client().hit(conn, "GET", "/health", { key: false })).toEqual({
      status: 200,
      body: null,
    });
    const e = await err(client().projects(conn));
    expect(e.code).toBe("invalid");
  });

  test("khoá không đọc được: hit ném SecretUseError; get ⇒ disabled", async () => {
    keyValue = null;
    await expect(client().hit(conn, "GET", "/version")).rejects.toBeInstanceOf(SecretUseError);
    const e = await err(client().get(conn, "/version"));
    expect(e.code).toBe("disabled");
    expect(seen).toHaveLength(0);
  });

  test("projects ⇒ id hợp lệ sắp tăng", async () => {
    expect(await client().projects(conn)).toEqual(["a", "b"]);
  });
});

describe("HUB-FR-132 · KhProjectsCache (D5)", () => {
  const fake = () => {
    let n = 0;
    let fail = false;
    return {
      calls: () => n,
      fail: (v: boolean) => {
        fail = v;
      },
      projects: async () => {
        n++;
        await Bun.sleep(5);
        if (fail) throw new KhCallError("server_error", 500);
        return [`p${n}`];
      },
    };
  };

  test("trong 300 s dùng cache; quá hạn gọi lại", async () => {
    let t = 0;
    const f = fake();
    const cache = new KhProjectsCache(f, () => t);
    expect(await cache.get(conn)).toEqual(["p1"]);
    t = 299_999;
    expect(await cache.get(conn)).toEqual(["p1"]);
    t = 300_000;
    expect(await cache.get(conn)).toEqual(["p2"]);
    expect(f.calls()).toBe(2);
  });

  test("single-flight; đổi version ⇒ khoá mới", async () => {
    const f = fake();
    const cache = new KhProjectsCache(f, () => 0);
    const [a, b] = await Promise.all([cache.get(conn), cache.get(conn)]);
    expect([a, b, f.calls()]).toEqual([["p1"], ["p1"], 1]);
    expect(await cache.get({ ...conn, version: 2 })).toEqual(["p2"]);
  });

  test("lỗi không cache", async () => {
    const f = fake();
    const cache = new KhProjectsCache(f, () => 0);
    f.fail(true);
    await expect(cache.get(conn)).rejects.toBeInstanceOf(KhCallError);
    f.fail(false);
    expect(await cache.get(conn)).toEqual(["p2"]);
  });
});
