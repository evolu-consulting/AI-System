// HUB-FR-66 · spec H4b2 §3 A · A05/A08b ở mức route (không DB): `:id` không uuid ⇒ 400; hình dạng sai ⇒ 400 đúng path
// trước khi mở transaction; thân có trường lạ (`value`, Q7) ⇒ 400. Ca chạm DB ở `tests/acceptance/H4b2/providers.int`.
import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { mapError } from "../../../lib/errors";
import { providerRoutes } from "./providers.routes";
import { ProvidersService } from "./providers.service";

const noDb = new Proxy(
  {},
  {
    get: () => {
      throw new Error("DB must not be touched");
    },
  },
);

function app(dev = false): Hono<AuthVars> {
  const a = new Hono<AuthVars>();
  a.onError((err, c) => {
    const m = mapError(err);
    return c.json(m.body, m.status);
  });
  const svc = new ProvidersService({ db: noDb as never, audit: noDb as never, env: { dev } });
  a.route("/s", providerRoutes(svc, { check: async () => noDb as never }));
  return a;
}
type Err = { error: { code: string; details?: { issues?: { path: string[] }[] } } };
const send = async (a: Hono<AuthVars>, method: string, path: string, body?: unknown) => {
  const r = await a.request(`/s${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const j = (await r.json()) as Err;
  return {
    status: r.status,
    code: j.error.code,
    paths: (j.error.details?.issues ?? []).map((i) => i.path.join(".")),
  };
};
const api = (o: object = {}) => ({
  key: "qc-api",
  kind: "api",
  vendor: "openai",
  base_url: null,
  secret_id: "a4b20000-0000-4000-8000-000000000002",
  ...o,
});

describe("providerRoutes · 400 không chạm DB", () => {
  it("A08b · :id không uuid ⇒ 400 cho GET/PUT/PATCH/DELETE/check", async () => {
    for (const [m, p] of [
      ["GET", "/providers/abc"],
      ["PUT", "/providers/abc"],
      ["PATCH", "/providers/abc/enabled"],
      ["DELETE", "/providers/abc?version=1"],
      ["POST", "/providers/abc/check"],
    ] as const)
      expect([m, p, (await send(app(), m, p, {})).status]).toEqual([m, p, 400]);
  });

  it("A05 · hình dạng sai ⇒ 400 path đúng", async () => {
    const cases: [object, string][] = [
      [api({ secret_id: null }), "secret_id"],
      [api({ kind: "subscription" }), "secret_id"],
      [api({ kind: "subscription", secret_id: null, base_url: "https://x.test" }), "base_url"],
      [api({ base_url: "http://api.example.test" }), "base_url"],
      [api({ base_url: "http://127.0.0.1:8080" }), "base_url"],
      [api({ vendor: "dify" }), "vendor"],
      [api({ max_concurrency: 0 }), "max_concurrency"],
    ];
    for (const [b, path] of cases) {
      const r = await send(app(), "POST", "/providers", b);
      expect([r.status, r.code, r.paths]).toEqual([400, "VALIDATION_ERROR", [path]]);
    }
  });

  it("Q7 · thân có `value` ⇒ 400; DELETE thiếu version ⇒ 400", async () => {
    expect((await send(app(), "POST", "/providers", api({ value: "sk-x" }))).status).toBe(400);
    const id = "a4b20000-0000-4000-8000-000000000001";
    expect((await send(app(), "DELETE", `/providers/${id}`)).status).toBe(400);
  });
});
