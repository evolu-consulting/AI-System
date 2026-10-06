// HUB-FR-78 · unit B1 H3b: `parseAdminQuery` giữ `tenant_id` (PL4); `parseQuery` của chat vẫn bỏ (H1-R03, A7).
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { z } from "zod";
import { mapError } from "./errors";
import { parseAdminQuery, parseQuery } from "./http";

const Q = z.strictObject({ tenant_id: z.uuid().optional(), agent_id: z.uuid().optional() });
const TID = "a0000000-0000-4000-8000-000000000001";

function app() {
  const a = new Hono();
  a.get("/admin", (c) => c.json(parseAdminQuery(c, Q)));
  a.get("/chat", (c) => c.json(parseQuery(c, Q)));
  a.onError((err, c) => {
    const { status, body } = mapError(err);
    return c.json(body, status);
  });
  return a;
}

type ErrBody = { error: { code: string; details: { issues: { path: unknown[] }[] } } };

describe("H3b B1 · parseAdminQuery", () => {
  test("HUB-FR-78 · giữ tenant_id", async () => {
    const res = await app().request(`/admin?tenant_id=${TID}`);
    expect(await res.json()).toEqual({ tenant_id: TID });
  });

  test("HUB-FR-78 · tenant_id sai dạng ⇒ 400 VALIDATION_ERROR (không bị bỏ qua)", async () => {
    const res = await app().request("/admin?tenant_id=x");
    expect(res.status).toBe(400);
    const b = (await res.json()) as ErrBody;
    expect(b.error.code).toBe("VALIDATION_ERROR");
    expect(b.error.details.issues[0]?.path).toEqual(["tenant_id"]);
  });

  test("HUB-FR-78 · khoá lạ ⇒ 400 (schema strict)", async () => {
    const res = await app().request("/admin?foo=1");
    expect(res.status).toBe(400);
  });

  test("HUB-FR-40 · parseQuery (chat) vẫn bỏ tenant_id/user_id", async () => {
    const res = await app().request("/chat?tenant_id=x&user_id=y");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });
});
