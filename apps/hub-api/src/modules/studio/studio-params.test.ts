// HUB-FR-66 · spec H4b2 §3 · path param không phải uuid ⇒ 400 VALIDATION_ERROR (cả path con chưa có handler).
import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { mapError } from "../../lib/errors";
import { parseUuidParam, uuidParams } from "./studio-params";

const ID = "a4b20000-0000-4000-8000-000000000001";

function app(): Hono {
  const a = new Hono();
  a.onError((err, c) => {
    const m = mapError(err);
    return c.json(m.body, m.status);
  });
  a.use("/p/:id/*", uuidParams("id"));
  a.get("/p/:id", (c) => c.json({ id: parseUuidParam(c) }));
  return a;
}

describe("parseUuidParam / uuidParams", () => {
  it("uuid ⇒ qua", async () => {
    const r = await app().request(`/p/${ID}`);
    expect([r.status, await r.json()]).toEqual([200, { id: ID }]);
  });
  it("không uuid ⇒ 400 path [id]", async () => {
    const r = await app().request("/p/abc");
    const b = (await r.json()) as {
      error: { code: string; details: { issues: { path: string[] }[] } };
    };
    expect([r.status, b.error.code, b.error.details.issues[0]?.path]).toEqual([
      400,
      "VALIDATION_ERROR",
      ["id"],
    ]);
  });
  it("path con chưa có handler ⇒ middleware vẫn 400 trước 404", async () => {
    expect((await app().request("/p/abc/check", { method: "POST" })).status).toBe(400);
    expect((await app().request(`/p/${ID}/check`, { method: "POST" })).status).toBe(404);
  });
});
