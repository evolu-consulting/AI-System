// ADM-FR-40, ADM-FR-41, ADM-FR-42, ADM-FR-51, ADM-FR-52 · hạ tầng test int M4 khối A + B (test-plan §1): bọc env M3
// (DB test, owner, token, listener config_changed) + app có `deps.mailer` (mailer giả trong bộ nhớ hoặc ném lỗi),
// reset thêm `DELETE hub.usage_logs`, NOTIFY `quota_threshold` (vai Hub). Không chứa `it(...)`.
// Module sản phẩm nạp LƯỜI (app dựng ở lần gọi đầu) để lỗi "chưa có module" rơi vào thân ca, không vào beforeAll.
// Khối C + D chỉ thêm export.
import { createDb, type Db } from "@ai/db";
import { makeHashes } from "../M1/_data";
import { ADMIN_API_URL } from "../M1/_fixtures";
import { loadApp, loadJwt } from "../M1/_modules";
import type { CatalogParts } from "../M2/_data";
import type { Caller, Opts, Res } from "../M2/_fixtures";
import { loadSecretCrypto } from "../M2/_modules";
import type { PermParts } from "../M3/_data";
import { createM3Env, type Hooks, type M3Env } from "../M3/_fixtures";
import { clearUsage } from "./_data";
import { loadMailerLib } from "./_modules";

export * from "../M3/_fixtures";
export * from "./_data";

type AppLike = { fetch: (req: Request) => Response | Promise<Response> };

export type MailMessage = { to: readonly string[]; subject: string; text: string; html?: string };
/** Mailer giả (plan-cd §9 `Mailer`): ghi lại thư; `fail` đặt mã → `send` ném lỗi mang `code` đó (không ghi). */
export type FakeMailer = {
  sent: MailMessage[];
  fail: string | null;
  send: (m: MailMessage) => Promise<void>;
};

/** Lỗi gửi thư: dùng `MailError` thật nếu module đã có (để `instanceof` ở evaluator đúng), không thì Error mang `code`. */
async function mailError(code: string): Promise<Error> {
  try {
    const lib = await loadMailerLib();
    const e = new lib.MailError(code) as Error & { code?: string };
    if (e.code === code) return e;
  } catch {
    // module chưa có (trước task TM) → dùng bản thay thế
  }
  return Object.assign(new Error(code), { name: "MailError", code });
}

export function fakeMailer(): FakeMailer {
  const m: FakeMailer = {
    sent: [],
    fail: null,
    send: async (msg) => {
      if (m.fail) throw await mailError(m.fail);
      m.sent.push({ ...msg, to: [...msg.to] });
    },
  };
  return m;
}

export type M4Env = M3Env & {
  /** mailer của app chính (`env.call`); `mailer.sent` xoá ở mỗi `reset4`. */
  mailer: FakeMailer;
  /** Dựng thêm app có mailer/hook/Db riêng. */
  makeApp4: (o?: { mailer?: FakeMailer; hooks?: Hooks; db?: Db }) => Promise<{
    call: Caller;
  }>;
  /** reset M3 (M1 + catalog + quyền; quota/alerts theo TRUNCATE tenants CASCADE) + `DELETE hub.usage_logs` + xoá thư. */
  reset4: (o?: { catalog?: CatalogParts; perms?: PermParts }) => Promise<void>;
  /** Vai Hub: `NOTIFY quota_threshold` payload `{tenant_id}` (plan-contract §2.5). */
  notifyQuota: (tenantId: string) => Promise<void>;
  /** Gọi API bằng token user fixture qua app có mailer: `await env.by("acme", "binh")("GET", "/admin/usage")`. */
  by: (
    tenant: string,
    username: string,
  ) => (method: string, path: string, body?: unknown) => Promise<Res>;
};

let hashesCache: ReturnType<typeof makeHashes> | undefined;
const hashes = () => {
  hashesCache ??= makeHashes();
  return hashesCache;
};

export async function createM4Env(
  o: { catalog?: CatalogParts; perms?: PermParts } = {},
): Promise<M4Env> {
  const m3 = await createM3Env(o);
  const dbs: Db[] = [];

  const makeApp4: M4Env["makeApp4"] = async (x = {}) => {
    const h = await hashes();
    const jwt = await loadJwt();
    const { createApp } = await loadApp();
    const sc = await loadSecretCrypto();
    const database = x.db ?? createDb(ADMIN_API_URL, { max: 8 });
    if (!x.db) dbs.push(database);
    const deps: Record<string, unknown> = {
      db: database,
      keys: await jwt.loadJwtKeys(m3.keys.env),
      appEnv: "test",
      dummyHash: h.pw,
      now: m3.clock.now,
      secretKey: sc.parseMasterKey(m3.masterKeyB64),
      mailer: x.mailer ?? fakeMailer(),
    };
    if (x.hooks) deps.testHooks = x.hooks;
    const app = createApp(
      { version: "0.0.0", corsOrigins: ["http://localhost:3000"] },
      deps,
    ) as AppLike;
    return { call: (method, path, opts: Opts = {}) => fetchApp(app, method, path, opts) };
  };

  const mailer = fakeMailer();
  let main: Promise<{ call: Caller }> | undefined;
  const call: Caller = async (method, path, opts) => {
    main ??= makeApp4({ mailer });
    return (await main).call(method, path, opts);
  };

  return {
    ...m3,
    mailer,
    makeApp4,
    call,
    get: (p, x) => call("GET", p, x),
    post: (p, x) => call("POST", p, x),
    put: (p, x) => call("PUT", p, x),
    patch: (p, x) => call("PATCH", p, x),
    del: (p, x) => call("DELETE", p, x),
    as: async (method, path, body) => call(method, path, { token: await m3.admin(), body }),
    by: (tenant, username) => async (method, path, body) =>
      call(method, path, { token: await m3.token(tenant, username), body }),
    reset: async (parts) => {
      await m3.reset(parts);
      await clearUsage(m3.owner);
      mailer.sent.length = 0;
      mailer.fail = null;
    },
    reset4: async (x = {}) => {
      await m3.reset3(x);
      await clearUsage(m3.owner);
      mailer.sent.length = 0;
      mailer.fail = null;
    },
    notifyQuota: async (tenantId) => {
      await m3.owner`select pg_notify('quota_threshold', ${JSON.stringify({ tenant_id: tenantId })}::text)`;
    },
    close: async () => {
      for (const d of dbs) await d.close();
      await m3.close();
    },
  };
}

async function fetchApp(app: AppLike, method: string, path: string, o: Opts): Promise<Res> {
  const headers = new Headers(o.headers);
  if (o.token) headers.set("authorization", `Bearer ${o.token}`);
  const body = o.raw ?? (o.body === undefined ? undefined : JSON.stringify(o.body));
  if (body !== undefined) headers.set("content-type", "application/json");
  const res = await app.fetch(new Request(`http://localhost${path}`, { method, headers, body }));
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return {
    status: res.status,
    headers: res.headers,
    text,
    json,
    cookies: res.headers.getSetCookie(),
  } as Res;
}
