// W1 · "Việc của tôi": `GET /pack/contracts/my-work` (quyền `read`) và `POST /pack/contracts/my-work/followups/:id/{done,snooze}`
// (hẹn nhắc là của riêng người dùng — như mgmt-app, người xem cũng được đặt/đóng). Guard TRƯỚC đọc thân/tham số; `:id` sai dạng ⇒ 400;
// tenant/người dùng chỉ từ token; query/thân strict (khoá lạ như `tenant_id` ⇒ 400); hẹn nhắc của người khác ≡ không có ⇒ 404.
import {
  DoneRequestSchema,
  FollowupCreateSchema,
  FollowupsQuerySchema,
  MyWorkQuerySchema,
  SnoozeRequestSchema,
} from "@ai/contracts";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { appError } from "../../../../lib/errors";
import { parseQuery, parseWith, readJson } from "../../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import { FollowupFail, type FollowupsUsecases } from "../application/followups.usecase";
import { type MyWork, MyWorkFail } from "../application/mywork.usecase";

const KEY = "contracts";

const who = (c: Context<PackGuardVars>) => {
  const u = c.get("user");
  return { tenantId: u.tenantId, userId: u.userId };
};
const run = <T>(p: Promise<T>): Promise<T> =>
  p.catch((e) => {
    if (e instanceof MyWorkFail || e instanceof FollowupFail) throw appError("NOT_FOUND");
    throw e;
  });

export function myWorkRoutes(
  view: PackAccessView,
  d: { mywork: MyWork; followups: FollowupsUsecases },
): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const read = packGuard(view, KEY, "read");
  r.get("/my-work", read, async (c) => {
    parseQuery(c, MyWorkQuerySchema);
    return c.json(await d.mywork.list(who(c)));
  });
  // Xong / nhắc lại sau: hai đường (`/my-work/followups/:id/*` của màn, `/followups/:id/*` như mgmt-app), cùng xử lý.
  for (const base of ["/my-work/followups", "/followups"]) {
    r.post(`${base}/:id/done`, read, async (c) => {
      const id = parseWith(z.uuid(), c.req.param("id"));
      parseWith(DoneRequestSchema, await readJson(c));
      return c.json(await run(d.mywork.done(who(c), id)));
    });
    r.post(`${base}/:id/snooze`, read, async (c) => {
      const id = parseWith(z.uuid(), c.req.param("id"));
      const b = parseWith(SnoozeRequestSchema, await readJson(c));
      return c.json(await run(d.mywork.snooze(who(c), id, b.at)));
    });
  }
  r.get("/followups", read, async (c) => {
    const q = parseQuery(c, FollowupsQuerySchema);
    return c.json(await d.followups.mine(who(c), q.subject_id ?? null));
  });
  // Hẹn nhắc là của riêng người dùng (mgmt-app: người xem cũng đặt được) ⇒ quyền `read`; chủ thể không thấy ⇒ 404.
  r.post("/followups", read, async (c) => {
    const b = parseWith(FollowupCreateSchema, await readJson(c));
    return c.json(await run(d.followups.create(who(c), b)), 201);
  });
  return r;
}
