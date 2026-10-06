// HUB-FR-78, HUB-FR-87 · unit B1 H3b: `requireAdminRole` (R01, PL8) + 5 mã `HUB_ADMIN_ERRORS` trong map lỗi Hub.
import { describe, expect, test } from "bun:test";
import type { Role } from "@ai/contracts";
import { HUB_ADMIN_ERRORS } from "@ai/contracts/hub-admin";
import { Hono } from "hono";
import { requireAdminRole } from "./admin-role.middleware";
import type { AuthUser, AuthVars } from "./auth.middleware";
import { appError, ERROR_MESSAGES, mapError } from "./errors";

const TID = "a0000000-0000-4000-8000-000000000001";
const SUB = "a0000000-0000-4000-8000-0000000000a1";

function app(user?: AuthUser) {
  const a = new Hono<AuthVars>();
  let reached = 0;
  a.use("*", async (c, next) => {
    if (user) c.set("user", user);
    await next();
  });
  a.use("*", requireAdminRole());
  a.get("/x", (c) => {
    reached++;
    return c.json({ ok: true });
  });
  a.onError((err, c) => {
    const { status, body } = mapError(err);
    return c.json(body, status);
  });
  return { a, reached: () => reached };
}

describe("H3b B1 · requireAdminRole", () => {
  test.each(["tenant_admin", "platform_admin"] as Role[])("HUB-FR-78 · %s đi qua", async (role) => {
    const { a, reached } = app({ userId: SUB, tenantId: TID, role });
    const res = await a.request("/x");
    expect(res.status).toBe(200);
    expect(reached()).toBe(1);
  });

  test("HUB-FR-78 · member ⇒ 403 FORBIDDEN, không tới handler", async () => {
    const { a, reached } = app({ userId: SUB, tenantId: TID, role: "member" });
    const res = await a.request("/x?tenant_id=bad");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: "FORBIDDEN", message: "Forbidden" } });
    expect(reached()).toBe(0);
  });

  test("HUB-FR-78 · vắng user (sai thứ tự middleware) ⇒ 401 AUTH_EXPIRED", async () => {
    const { a, reached } = app();
    const res = await a.request("/x");
    expect(res.status).toBe(401);
    expect(reached()).toBe(0);
  });
});

describe("H3b B1 · HUB_ADMIN_ERRORS trong map lỗi", () => {
  test("HUB-FR-78 · đủ 5 mã, status lấy từ contract, message cố định", () => {
    const msgs = {
      FORBIDDEN: "Forbidden",
      TENANT_REQUIRED: "tenant_id is required",
      INVALID_REFERENCE: "Invalid reference",
      NOT_ENTITLED: "Not entitled",
      AGENT_NOT_GRANTABLE: "Agent cannot be granted",
    } as const;
    for (const [code, status] of Object.entries(HUB_ADMIN_ERRORS)) {
      const c = code as keyof typeof HUB_ADMIN_ERRORS;
      expect(appError(c).status).toBe(status);
      expect(ERROR_MESSAGES[c]).toBe(msgs[c]);
    }
  });

  test("HUB-FR-78 · details giữ nguyên trong body", () => {
    const { status, body } = mapError(appError("INVALID_REFERENCE", { field: "agent_id" }));
    expect(status).toBe(400);
    expect(body).toEqual({
      error: {
        code: "INVALID_REFERENCE",
        message: "Invalid reference",
        details: { field: "agent_id" },
      },
    });
  });
});
