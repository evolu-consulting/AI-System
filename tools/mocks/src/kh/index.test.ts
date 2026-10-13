// HUB-FR-131 · HUB-FR-132 · HUB-FR-133 · plan K1 §7 · mock KnowledgeHub: gate khoá, route, kịch bản, điều khiển, mỗi instance riêng.
import { describe, expect, test } from "bun:test";
import { createKhMock } from "./index";

const KEY = "k-test";
const mk = () => createKhMock({ apiKey: KEY, timeoutMs: 20, projects: ["p1", "p2"] });
const req = (app: ReturnType<typeof mk>, path: string, init: RequestInit = {}) =>
  app.request(path, init);
// biome-ignore lint/suspicious/noExplicitAny: thân JSON của mock
const js = async (r: Response | Promise<Response>): Promise<any> => (await r).json();
const withKey = (body?: unknown, method = body === undefined ? "GET" : "POST"): RequestInit => ({
  method,
  headers: { "X-KH-Key": KEY, "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const ctl = (app: ReturnType<typeof mk>, path: string, body: unknown, method = "PUT") =>
  req(app, path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("HUB-FR-131 · mock KH gate + route", () => {
  test("/health không khoá; /version không khoá ⇒ 401 {detail}; có khoá ⇒ v6.4", async () => {
    const app = mk();
    expect(await js(req(app, "/health"))).toEqual({
      status: "ok",
      model: "BAAI/bge-m3",
    });
    const r = await req(app, "/version");
    expect([r.status, await js(r)]).toEqual([401, { detail: "missing or invalid API key" }]);
    expect(await js(req(app, "/version", withKey()))).toMatchObject({ version: "v6.4" });
    const bearer = await req(app, "/version", { headers: { Authorization: `Bearer ${KEY}` } });
    expect(bearer.status).toBe(200);
  });

  test("/projects ⇒ object projects theo id", async () => {
    const b = await js(req(mk(), "/projects", withKey()));
    expect(Object.keys(b.projects)).toEqual(["p1", "p2"]);
  });

  test("/vector/query: hit theo project, max_chars, project lạ ⇒ 403", async () => {
    const app = mk();
    await ctl(app, "/__mock/kh/projects/p1", {
      hits: [
        { score: 0.1, source_text: "low" },
        { score: 0.9, source_text: "abcdefghij" },
      ],
    });
    const r = await req(
      app,
      "/vector/query",
      withKey({ text: "q", project: "p1", k: 8, max_chars: 4 }),
    );
    const { hits } = await js(r);
    expect(hits.map((h: { source_text: string }) => h.source_text)).toEqual(["abcd", "low"]);
    expect(hits[0]).toMatchObject({ truncated: true, text_len: 10 });
    const x = await req(app, "/vector/query", withKey({ text: "q", project: "nope" }));
    expect(x.status).toBe(403);
  });

  test("/vector/add upsert theo id; calls không chứa giá trị khoá", async () => {
    const app = mk();
    for (let i = 0; i < 2; i++)
      await req(app, "/vector/add", withKey({ id: "kw-1", text: "t", scope: "log", metadata: {} }));
    const log = await js(req(app, "/__mock/kh/calls"));
    expect(log.vectors).toEqual([{ id: "kw-1", text: "t", scope: "log", metadata: {}, writes: 2 }]);
    expect(log.calls[0]).toMatchObject({ path: "/vector/add", sent_key: true, key_ok: true });
    expect(JSON.stringify(log)).not.toContain(KEY);
  });
});

describe("HUB-FR-132 · mock KH kịch bản + điều khiển", () => {
  test.each([
    ["server_error", 500],
    ["rate_limited", 429],
  ])("%s ⇒ %d trên /vector/*", async (scenario, status) => {
    const app = mk();
    await ctl(app, "/__mock/kh", { scenario });
    expect((await req(app, "/vector/query", withKey({ text: "q", project: "p1" }))).status).toBe(
      status,
    );
  });

  test("server_error_once ⇒ 500 rồi 200", async () => {
    const app = mk();
    await ctl(app, "/__mock/kh", { scenario: "server_error_once" });
    const call = () => req(app, "/vector/add", withKey({ id: "a", text: "t" }));
    expect([(await call()).status, (await call()).status]).toEqual([500, 200]);
  });

  test("key_rejected ⇒ khoá đúng vẫn 401; auth:false ⇒ không khoá vẫn 200", async () => {
    const app = mk();
    await ctl(app, "/__mock/kh", { scenario: "key_rejected" });
    expect((await req(app, "/version", withKey())).status).toBe(401);
    await ctl(app, "/__mock/kh", { scenario: "ok", auth: false });
    expect((await req(app, "/version")).status).toBe(200);
  });

  test("bad_body ⇒ html; timeout ⇒ trễ rồi 200", async () => {
    const app = mk();
    await ctl(app, "/__mock/kh", { scenario: "bad_body" });
    const r = await req(app, "/vector/query", withKey({ text: "q", project: "p1" }));
    expect(r.headers.get("content-type")).toContain("text/html");
    await ctl(app, "/__mock/kh", { scenario: "timeout" });
    const t0 = Date.now();
    await req(app, "/vector/query", withKey({ text: "q", project: "p1" }));
    expect(Date.now() - t0).toBeGreaterThanOrEqual(15);
  });
});

describe("HUB-FR-132 · mock KH điều khiển /__mock/kh", () => {
  test("PUT version/model/projects; cấu hình sai ⇒ 400; reset ⇒ mặc định", async () => {
    const app = mk();
    await ctl(app, "/__mock/kh", {
      scenario: "ok",
      version: "v6.3",
      model: "x-en",
      projects: ["z"],
    });
    expect(await js(req(app, "/version", withKey()))).toMatchObject({
      version: "v6.3",
      model: "x-en",
    });
    expect((await ctl(app, "/__mock/kh", { scenario: "nope" })).status).toBe(400);
    await req(app, "/__mock/kh/reset", { method: "POST" });
    const b = await js(req(app, "/projects", withKey()));
    expect(Object.keys(b.projects)).toEqual(["p1", "p2"]);
    expect((await js(req(app, "/__mock/kh/calls"))).calls).toHaveLength(1);
  });

  test("mỗi instance trạng thái riêng", async () => {
    const a = mk();
    const b = mk();
    await ctl(a, "/__mock/kh", { scenario: "server_error" });
    expect((await req(b, "/vector/query", withKey({ text: "q", project: "p1" }))).status).toBe(200);
  });
});
