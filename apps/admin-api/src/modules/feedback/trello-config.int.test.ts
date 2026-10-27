// trello-config-ui · int (viết trước code): platform_admin ghi/đọc cấu hình Trello không lộ secret (DB chỉ có bản mã), non-platform 403,
// góp ý dùng cấu hình DB; không có DB ⇒ env như cũ; xoá ⇒ về env; "Kiểm tra kết nối" chỉ GET list. Trello thật: KHÔNG gọi (fake fetch).
import { afterAll, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { randomBytes } from "node:crypto";
import { createDb, type Db } from "@ai/db";
import {
  ADMIN_API_URL,
  createEnv,
  type Env,
  type Json,
} from "../../../../../tests/acceptance/M1/_fixtures";
import { createApp } from "../../app";
import { loadJwtKeys } from "../../lib/jwt";
import { parseMasterKey } from "../../lib/secret-crypto";

const ENV_CFG = { apiKey: "ENV-KEY-LEAK-aaaa", token: "ENV-TOK-LEAK-bbbb", listId: "envList" };
const KEY = "DB-KEY-LEAK-1234";
const TOK = "DB-TOK-LEAK-5678";
const PATH = "/admin/integrations/trello";

type Seen = { url: string; method: string; body: string; auth: string };
let env: Env;
let db: Db;
let seen: Seen[] = [];
let onCall: (() => void) | undefined;

const fakeFetch = async (url: string, init: RequestInit): Promise<Response> => {
  const body = init.body instanceof URLSearchParams ? init.body.toString() : "";
  const auth = new Headers(init.headers).get("authorization") ?? "";
  seen.push({ url, method: String(init.method), body, auth });
  onCall?.();
  if (url.includes("/lists/")) return new Response(JSON.stringify({ id: "x", name: "Mới" }));
  return new Response(JSON.stringify({ id: "card1", shortUrl: "https://trello.test/c/1" }));
};

let app: { fetch: (r: Request) => Response | Promise<Response> };
async function call(method: string, path: string, token: string, body?: unknown) {
  const headers = new Headers({ authorization: `Bearer ${token}` });
  if (body !== undefined) headers.set("content-type", "application/json");
  const res = await app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const text = await res.text();
  return { status: res.status, text, json: (text ? JSON.parse(text) : undefined) as Json };
}

/** Gửi góp ý rồi chờ đúng tín hiệu lời gọi Trello đầu tiên (đẩy thẻ chạy sau commit, không chặn response). */
async function sendFeedbackAndWaitTrello(): Promise<Seen> {
  const called = new Promise<void>((r) => {
    onCall = r;
  });
  const res = await call("POST", "/auth/feedback", await env.token("acme", "an"), {
    kind: "bug",
    message: "lỗi",
    app: "contracts",
  });
  expect(res.status).toBe(201);
  await called;
  onCall = undefined;
  const s = seen.find((x) => x.url.endsWith("/cards"));
  if (!s) throw new Error("không có lời gọi tạo thẻ");
  return s;
}

/** audit_log không bị reset giữa các test ⇒ so từ mốc seq. */
const auditSeq = async (): Promise<string> =>
  String((await env.owner`select coalesce(max(seq), 0) as s from admin.audit_log`)[0]?.s ?? 0);

beforeAll(async () => {
  env = await createEnv();
  db = createDb(ADMIN_API_URL, { max: 3 });
  app = createApp(
    { version: "0.0.0", corsOrigins: [] },
    {
      db,
      keys: await loadJwtKeys(env.keys.env),
      appEnv: "test",
      dummyHash: env.hashes.pw,
      now: env.clock.now,
      secretKey: parseMasterKey(randomBytes(32).toString("base64")),
      trello: ENV_CFG,
      trelloFetch: fakeFetch,
    },
  );
});
afterAll(async () => {
  await db.close();
  await env.close();
});
beforeEach(async () => {
  await env.reset();
  await env.owner`delete from admin.trello_config`;
  seen = [];
});

describe("trello-config · quyền", () => {
  it("tenant_admin và user thường ⇒ 403 cho mọi thao tác", async () => {
    for (const tok of [await env.token("acme", "binh"), await env.token("acme", "an")]) {
      expect((await call("GET", PATH, tok)).status).toBe(403);
      expect(
        (await call("PUT", PATH, tok, { api_key: "a", token: "b", list_id: "c" })).status,
      ).toBe(403);
      expect((await call("DELETE", PATH, tok)).status).toBe(403);
      expect((await call("POST", `${PATH}/check`, tok)).status).toBe(403);
    }
    expect(seen).toHaveLength(0);
  });
});

describe("trello-config · platform_admin", () => {
  it("ghi ⇒ DB chỉ có bản mã; đọc/ghi/audit/log không lộ secret; để trống = giữ nguyên", async () => {
    const plat = await env.token("platform", "admin");
    const base = await auditSeq();
    const log = spyOn(console, "error");
    const log2 = spyOn(console, "log");
    try {
      expect((await call("GET", PATH, plat)).json).toMatchObject({
        source: "env",
        env_configured: true,
        api_key: { set: false, last4: null },
      });
      // lần đầu thiếu token ⇒ 400
      expect((await call("PUT", PATH, plat, { api_key: KEY, list_id: "dbList" })).status).toBe(400);

      const saved = await call("PUT", PATH, plat, { api_key: KEY, token: TOK, list_id: "dbList" });
      expect(saved.status).toBe(200);
      expect(saved.json).toMatchObject({
        source: "db",
        api_key: { set: true, last4: "1234" },
        token: { set: true, last4: "5678" },
        list_id: "dbList",
      });
      // chỉ đổi list (key/token trống) ⇒ giữ nguyên secret
      const kept = await call("PUT", PATH, plat, { api_key: "", list_id: "dbList2" });
      expect(kept.json).toMatchObject({ api_key: { last4: "1234" }, list_id: "dbList2" });

      const got = await call("GET", PATH, plat);
      for (const r of [saved, kept, got]) {
        expect(r.text).not.toContain("LEAK");
      }
      const raw = await env.owner`select * from admin.trello_config`;
      expect(raw).toHaveLength(1);
      expect(JSON.stringify(raw)).not.toContain("LEAK");
      expect(Buffer.from(raw[0]?.api_key_ct).toString("latin1")).not.toContain("LEAK");

      const audits = await env.owner`select action, entity, entity_name, summary, before, after
        from admin.audit_log where entity_name = 'integration.trello' and seq > ${base} order by seq`;
      expect(audits.map((a) => a.action)).toEqual(["update", "update"]);
      expect(audits[0]).toMatchObject({ entity: "config" });
      expect(JSON.stringify(audits)).not.toContain("LEAK");
      const logged = [...log.mock.calls, ...log2.mock.calls].flat().join("\n");
      expect(logged).not.toContain("LEAK");
    } finally {
      log.mockRestore();
      log2.mockRestore();
    }
  });

  it("kiểm tra kết nối ⇒ chỉ GET list bằng cấu hình đang hiệu lực, không tạo thẻ", async () => {
    const plat = await env.token("platform", "admin");
    const envCheck = await call("POST", `${PATH}/check`, plat);
    expect(envCheck.json).toEqual({ ok: true, source: "env", list_name: "Mới", error: null });
    await call("PUT", PATH, plat, { api_key: KEY, token: TOK, list_id: "dbList" });
    const dbCheck = await call("POST", `${PATH}/check`, plat);
    expect(dbCheck.json).toMatchObject({ ok: true, source: "db" });
    expect(seen.map((s) => s.method)).toEqual(["GET", "GET"]);
    expect(seen[1]?.url).toContain("/lists/dbList");
    expect(seen.some((s) => s.url.includes("/cards"))).toBe(false);
    expect(seen.map((s) => s.url).join()).not.toContain("LEAK");
    expect(seen[1]?.auth).toContain(KEY);
  });
});

describe("trello-config · góp ý dùng cấu hình", () => {
  it("không có DB ⇒ env như cũ", async () => {
    const s = await sendFeedbackAndWaitTrello();
    const form = new URLSearchParams(s.body);
    expect(form.get("key")).toBe(ENV_CFG.apiKey);
    expect(form.get("idList")).toBe("envList");
  });

  it("có DB ⇒ dùng DB; xoá cấu hình ⇒ về env", async () => {
    const plat = await env.token("platform", "admin");
    const base = await auditSeq();
    await call("PUT", PATH, plat, { api_key: KEY, token: TOK, list_id: "dbList" });
    const s = await sendFeedbackAndWaitTrello();
    const form = new URLSearchParams(s.body);
    expect([form.get("key"), form.get("token"), form.get("idList")]).toEqual([KEY, TOK, "dbList"]);

    expect((await call("DELETE", PATH, plat)).status).toBe(204);
    expect((await call("GET", PATH, plat)).json).toMatchObject({ source: "env" });
    const audits = await env.owner`select action from admin.audit_log
        where entity_name = 'integration.trello' and seq > ${base} order by seq`;
    expect(audits.map((a) => a.action)).toEqual(["update", "delete"]);
    seen = [];
    const s2 = await sendFeedbackAndWaitTrello();
    expect(new URLSearchParams(s2.body).get("idList")).toBe("envList");
  });
});
