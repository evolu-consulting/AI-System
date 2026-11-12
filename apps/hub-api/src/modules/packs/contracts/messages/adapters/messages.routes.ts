// CR-132 M3 · HD-MSG-01..12 · `/pack/contracts/messages/**` (mount dưới `/pack/contracts`): hội thoại, thành viên, tin, đã đọc, chưa đọc. Guard `read` của gói TRƯỚC
// khi đọc tham số/thân; user ngoài (đối tác) ⇒ 403 `PACK_FORBIDDEN`. Không phải thành viên / không có ⇒ 404 `MSG_NOT_FOUND` (cùng thân). Lỗi nghiệp vụ trả MÃ
// `MSG_ERRORS` (client dịch), không câu chữ riêng. KHÔNG realtime (M4), không tải tệp lên (M5).

import { ATTACH_MAX_BYTES } from "@ai/contracts/attach";
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
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { AppError, appError } from "../../../../../lib/errors";
import { parseJson, parseQuery } from "../../../../../lib/http";
import { type PackAccessView, type PackGuardVars, packGuard } from "../../../kit/public";
import { cleanFileName, fileNameOf } from "../../adapters/upload.routes";
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
const MULTIPART_SLACK = 64 * 1024;
const tooLarge = () =>
  new AppError("MSG_FILE_TOO_LARGE", MSG_ERRORS.MSG_FILE_TOO_LARGE, "MSG_FILE_TOO_LARGE");
const storageOff = () => new AppError("FILE_STORAGE_UNAVAILABLE", 503, "FILE_STORAGE_UNAVAILABLE");

type Routes = Hono<PackGuardVars>;
type Ctx = Context<PackGuardVars>;
/** Phần dùng chung của mọi route: guard `read`, người gọi (đối tác ⇒ 403), tham số uuid, no-store. */
type H = ReturnType<typeof helpers>;
function helpers(view: PackAccessView) {
  const who = (c: Ctx) => {
    const u = c.get("user");
    if (u.userKind === "external") throw forbidden(); // đối tác không nhắn tin nội bộ
    return { tenantId: u.tenantId, userId: u.userId, userKind: u.userKind };
  };
  const uuid = (c: Ctx, name: string) => {
    const v = z.uuid().safeParse(c.req.param(name));
    if (!v.success) throw notFound();
    return v.data;
  };
  const noStore = (c: Ctx) => c.header("cache-control", "no-store");
  return { read: packGuard(view, "contracts", "read"), who, uuid, noStore };
}

/** Hội thoại: danh sách, chưa đọc, tạo, chi tiết, đổi tên. */
function conversationRoutes(r: Routes, h: H, uc: MessagesUsecases): void {
  const { read, who, uuid, noStore } = h;
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
}

/** Thành viên: thêm, bớt / rời. */
function memberRoutes(r: Routes, h: H, uc: MessagesUsecases): void {
  const { read, who, uuid } = h;
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
}

/** Tin: danh sách, gửi, thu hồi, đã đọc. */
function messageRoutes(r: Routes, h: H, uc: MessagesUsecases): void {
  const { read, who, uuid, noStore } = h;
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
}

/** Tệp (M5): tải lên (multipart `file`, gắn `msg_files` ngay, chưa gửi) + tải xuống 302 tới FileBox. FileBox vắng ⇒ 503. */
function fileRoutes(r: Routes, h: H, uc: MessagesUsecases): void {
  const { read, who, uuid, noStore } = h;
  r.post(
    "/messages/conversations/:id/files",
    read,
    bodyLimit({
      maxSize: ATTACH_MAX_BYTES + MULTIPART_SLACK,
      onError: () => Promise.reject(tooLarge()),
    }),
    async (c) => {
      const w = who(c);
      const cid = uuid(c, "id");
      if (!uc.filesEnabled) throw storageOff();
      const form = await c.req.formData().catch(() => null);
      const file = form?.getAll("file").find((f): f is File => f instanceof Blob);
      if (!file) throw appError("VALIDATION_ERROR");
      if (file.size > ATTACH_MAX_BYTES) throw tooLarge();
      const name = cleanFileName(fileNameOf(file));
      const bytes = new Uint8Array(await file.arrayBuffer());
      return c.json(await run(uc.uploadFile(w, cid, { name, bytes })), 201);
    },
  );
  r.get("/messages/conversations/:id/files/:fileId", read, async (c) => {
    const w = who(c);
    const cid = uuid(c, "id");
    const fid = uuid(c, "fileId");
    if (!uc.filesEnabled) throw storageOff();
    const url = await run(uc.fileLink(w, cid, fid));
    noStore(c);
    return c.redirect(url, 302);
  });
}

export function messagesRoutes(view: PackAccessView, uc: MessagesUsecases): Routes {
  const r = new Hono<PackGuardVars>();
  const h = helpers(view);
  conversationRoutes(r, h, uc);
  memberRoutes(r, h, uc);
  messageRoutes(r, h, uc);
  fileRoutes(r, h, uc);
  return r;
}
