// CR-132 M3 · HD-MSG-01..12 · `/pack/contracts/messages/**` (mount dưới `/pack/contracts`): hội thoại, thành viên, tin, đã đọc, chưa đọc. Guard `read` của gói TRƯỚC
// khi đọc tham số/thân; user ngoài (đối tác) ⇒ 403 `PACK_FORBIDDEN`. Không phải thành viên / không có ⇒ 404 `MSG_NOT_FOUND` (cùng thân). Lỗi nghiệp vụ trả MÃ
// `MSG_ERRORS` (client dịch), không câu chữ riêng. KHÔNG realtime (M4), không tải tệp lên (M5).
import {
  AddMembersRequestSchema,
  CreateConversationRequestSchema,
  MarkReadRequestSchema,
  MSG_ERRORS,
  MsgConversationsQuerySchema,
  MsgListQuerySchema,
  RenameConversationRequestSchema,
  SendMessageRequestSchema,
} from "@ai/contracts/pack-contracts";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { AppError, appError } from "../../../../../lib/errors";
import { parseJson, parseQuery } from "../../../../../lib/http";
import { type PackAccessView, type PackGuardVars, packGuard } from "../../../kit/public";
import { type MessagesUsecases, MsgFail } from "../application/messages.usecase";
import { decodeCursor } from "../application/messages.view";

const notFound = () => new AppError("MSG_NOT_FOUND", MSG_ERRORS.MSG_NOT_FOUND, "MSG_NOT_FOUND");
const forbidden = () => new AppError("PACK_FORBIDDEN", 403, "Forbidden");
/** `MsgFail` ⇒ AppError(mã, HTTP theo `MSG_ERRORS`). */
const run = <T>(p: Promise<T>): Promise<T> =>
  p.catch((e) => {
    if (e instanceof MsgFail) throw new AppError(e.code, MSG_ERRORS[e.code], e.code);
    throw e;
  });
const SeqSchema = z.coerce.number().int().min(1);

export function messagesRoutes(view: PackAccessView, uc: MessagesUsecases): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const read = packGuard(view, "contracts", "read");
  const who = (c: Context<PackGuardVars>) => {
    const u = c.get("user");
    if (u.userKind === "external") throw forbidden(); // đối tác không nhắn tin nội bộ
    return { tenantId: u.tenantId, userId: u.userId, userKind: u.userKind };
  };
  const uuid = (c: Context<PackGuardVars>, name: string) => {
    const v = z.uuid().safeParse(c.req.param(name));
    if (!v.success) throw notFound();
    return v.data;
  };
  const noStore = (c: Context<PackGuardVars>) => c.header("cache-control", "no-store");

  r.get("/messages/unread", read, async (c) => {
    const out = await uc.unread(who(c));
    noStore(c);
    return c.json(out);
  });
  r.get("/messages/conversations", read, async (c) => {
    const w = who(c);
    const q = parseQuery(c, MsgConversationsQuerySchema);
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    if (q.cursor && !cursor)
      throw appError("VALIDATION_ERROR", {
        issues: [{ path: ["cursor"], code: "invalid", message: "cursor" }],
      });
    const out = await uc.list(w, { cursor, limit: q.limit });
    noStore(c);
    return c.json(out);
  });
  r.post("/messages/conversations", read, async (c) => {
    const w = who(c);
    const out = await run(uc.create(w, await parseJson(c, CreateConversationRequestSchema)));
    return c.json(out.detail, out.created ? 201 : 200);
  });
  r.get("/messages/conversations/:id", read, async (c) => {
    const w = who(c);
    const out = await run(uc.get(w, uuid(c, "id")));
    noStore(c);
    return c.json(out);
  });
  r.patch("/messages/conversations/:id", read, async (c) => {
    const w = who(c);
    const cid = uuid(c, "id");
    const body = await parseJson(c, RenameConversationRequestSchema);
    return c.json(await run(uc.rename(w, cid, body.title)));
  });
  r.post("/messages/conversations/:id/members", read, async (c) => {
    const w = who(c);
    const cid = uuid(c, "id");
    const body = await parseJson(c, AddMembersRequestSchema);
    return c.json(await run(uc.addMembers(w, cid, body.user_ids)));
  });
  r.delete("/messages/conversations/:id/members/:userId", read, async (c) => {
    const w = who(c);
    await run(uc.removeMember(w, uuid(c, "id"), uuid(c, "userId")));
    return c.body(null, 204);
  });
  r.get("/messages/conversations/:id/messages", read, async (c) => {
    const w = who(c);
    const cid = uuid(c, "id");
    const out = await run(uc.messages(w, cid, parseQuery(c, MsgListQuerySchema)));
    noStore(c);
    return c.json(out);
  });
  r.post("/messages/conversations/:id/messages", read, async (c) => {
    const w = who(c);
    const cid = uuid(c, "id");
    const out = await run(uc.send(w, cid, await parseJson(c, SendMessageRequestSchema)));
    return c.json(out.message, out.created ? 201 : 200);
  });
  r.delete("/messages/conversations/:id/messages/:seq", read, async (c) => {
    const w = who(c);
    const cid = uuid(c, "id");
    const seq = SeqSchema.safeParse(c.req.param("seq"));
    if (!seq.success) throw notFound();
    await run(uc.revoke(w, cid, seq.data));
    return c.body(null, 204);
  });
  r.post("/messages/conversations/:id/read", read, async (c) => {
    const w = who(c);
    const cid = uuid(c, "id");
    const body = await parseJson(c, MarkReadRequestSchema);
    return c.json(await run(uc.markRead(w, cid, body.seq)));
  });
  return r;
}
