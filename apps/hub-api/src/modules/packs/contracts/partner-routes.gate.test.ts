// CR-124 · q7 · mọi route `/pack/contracts/partner/*` cần công ty đã bật tính năng `contracts-partner-confirm` (cùng nguồn `tenantFeatureOn`
// với cap menu): tắt ⇒ 403 `PARTNER_FEATURE_OFF` kèm câu nghiệp vụ, TRƯỚC khi chạm DB/vai trò.
import { describe, expect, it } from "bun:test";
import type { Db } from "@ai/db";
import { Hono } from "hono";
import { AppError } from "../../../lib/errors";
import type { PackAccessView } from "../kit/public";
import { PARTNER_FEATURE } from "./nav.mount";
import { partnerModule } from "./partner-routes.mount";

const T = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const view = (on: boolean): PackAccessView => ({
  catalog: async () => ({
    features: [{ id: "f1", key: PARTNER_FEATURE, status: "on" }],
    entitled: new Set(on ? [`${T}:f1`] : []),
    grantGroups: new Map(),
  }),
  user: async () => undefined,
});
const app = (on: boolean) => {
  const a = new Hono();
  a.use("*", async (c, next) => {
    c.set("user" as never, { tenantId: T, userId: ID } as never);
    await next();
  });
  a.route("/pack/contracts", partnerModule({} as Db, view(on)) as never);
  a.onError((e, c) =>
    e instanceof AppError
      ? c.json({ error: { code: e.code, message: e.message } }, e.status)
      : c.json({ error: { code: "INTERNAL" } }, 500),
  );
  return a;
};

const CALLS: [string, string, unknown?][] = [
  ["GET", "/pack/contracts/partner/inbox"],
  ["POST", `/pack/contracts/partner/invites/${ID}/accept`],
  ["GET", `/pack/contracts/partner/sends/${ID}`],
  ["POST", `/pack/contracts/partner/sends/${ID}/record`, { outcome: "confirmed", by_name: "A" }],
  ["GET", "/pack/contracts/partner/settings"],
  [
    "PUT",
    "/pack/contracts/partner/settings",
    { important_min: 1, critical_min: 2, owner_user_id: null },
  ],
];

describe("CR-124 q7 · cổng tính năng contracts-partner-confirm trên /partner/*", () => {
  it("công ty chưa bật ⇒ 403 PARTNER_FEATURE_OFF + câu nghiệp vụ cho MỌI route đối tác", async () => {
    for (const [method, path, body] of CALLS) {
      const res = await app(false).request(path, {
        method,
        ...(body
          ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } }
          : {}),
      });
      expect(res.status).toBe(403);
      const j = (await res.json()) as { error: { code: string; message: string } };
      expect(j.error.code).toBe("PARTNER_FEATURE_OFF");
      expect(j.error.message).toContain("Công ty chưa bật Gửi đối tác xác nhận");
    }
  });
});
