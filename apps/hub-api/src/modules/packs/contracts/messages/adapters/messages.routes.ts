// CR-132 M3 · HD-MSG-01..12 · `/pack/contracts/messages/**` (mount dưới `/pack/contracts`): hội thoại, thành viên, tin, đã đọc, chưa đọc. Guard `read` của gói TRƯỚC
// khi đọc tham số/thân; user ngoài (đối tác) ⇒ 403 `PACK_FORBIDDEN`. Không phải thành viên / không có ⇒ 404 `MSG_NOT_FOUND` (cùng thân). Lỗi nghiệp vụ trả MÃ
// `MSG_ERRORS` (client dịch), không câu chữ riêng. CR-169: cuộc `partner` ở `partner.routes.ts`.

import { ATTACH_MAX_BYTES } from "@ai/contracts/attach";
import {
  AddMembersRequestSchema,
  CreateConversationRequestSchema,
  MarkReadRequestSchema,
  MarkUnreadRequestSchema,
  MsgCompaniesQuerySchema,
  MsgConversationsQuerySchema,
  MsgListQuerySchema,
  MsgPeopleQuerySchema,
  PinRequestSchema,
  RenameConversationRequestSchema,
  SendMessageRequestSchema,
} from "@ai/contracts/pack-contracts";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { appError } from "../../../../../lib/errors";
import { parseJson, parseQuery } from "../../../../../lib/http";
import type { PackAccessView, PackGuardVars } from "../../../kit/public";
import { cleanFileName, fileNameOf } from "../../adapters/upload.routes";
import type { MessagesUsecases } from "../application/messages.usecase";
import { decodeCursor } from "../application/messages.view";
import { type CompanyFilter, parseCompanyFilter } from "../domain/partner.rules";
import { attachQuery, searchRoutes } from "./messages-find.routes";
import { partnerChatRoutes } from "./partner.routes";
import {
  bytesResponse,
  type H,
  helpers,
  MULTIPART_SLACK,
  notFound,
  type Routes,
  run,
  SeqSchema,
  storageOff,
  tooLarge,
} from "./route.kit";

/** `company` sai dạng ⇒ 400 `VALIDATION_ERROR` (path `company`). */
function companyFilter(raw: string | undefined, tenantId: string): CompanyFilter {
  try {
    return parseCompanyFilter(raw, tenantId);
  } catch {
    throw appError("VALIDATION_ERROR", {
      issues: [{ path: ["company"], code: "invalid", message: "company" }],
    });
  }
}
/** Hội thoại: danh sách, chưa đọc, tạo, chi tiết, đổi tên. */
function conversationRoutes(r: Routes, h: H, uc: MessagesUsecases): void {
  const { read, who, uuid, noStore } = h;
  r.get("/messages/unread", read, async (c) => {
    const out = await run(uc.unread(who(c)));
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
    const filter = companyFilter(q.company, w.tenantId);
    const out = await run(
      uc.list(w, { cursor, limit: q.limit, filter, unreadOnly: q.unread === true }),
    );
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

/** CR-190 · ghim / đánh dấu chưa đọc của CHÍNH người gọi (cuộc nội bộ). Thân `{pinned}` / `{unread}`; trả `{pinned_at, marked_unread}`. Không phải thành viên ⇒ 404. */
function prefRoutes(r: Routes, h: H, uc: MessagesUsecases): void {
  const { read, who, uuid } = h;
  r.put("/messages/conversations/:id/pin", read, async (c) => {
    const w = who(c);
    const cid = uuid(c, "id");
    const body = await parseJson(c, PinRequestSchema);
    return c.json(await run(uc.pin(w, cid, body.pinned)));
  });
  r.put("/messages/conversations/:id/mark-unread", read, async (c) => {
    const w = who(c);
    const cid = uuid(c, "id");
    const body = await parseJson(c, MarkUnreadRequestSchema);
    return c.json(await run(uc.markUnread(w, cid, body.unread)));
  });
}

/** Tệp (M5): tải lên (multipart `file`, gắn `msg_files` ngay, chưa gửi) + tải xuống 302 tới FileBox (+ `/link` JSON). FileBox vắng ⇒ 503. */
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
  // Link ngắn hạn dạng JSON `{url}` cho trình duyệt: `<img src>` / tab mới dùng thẳng (không fetch xuyên origin tới FileBox ⇒ không cần CORS, chứng chỉ do trình duyệt xử lý).
  r.get("/messages/conversations/:id/files/:fileId/link", read, async (c) => {
    const w = who(c);
    const cid = uuid(c, "id");
    const fid = uuid(c, "fileId");
    if (!uc.filesEnabled) throw storageOff();
    const url = await run(uc.fileLink(w, cid, fid));
    noStore(c);
    return c.json({ url });
  });
  // CR-178 · byte tệp qua hub-api (Bearer) cho xem trước: link FileBox có thể khác origin ⇒ trình duyệt không `fetch` được (CORS).
  r.get("/messages/conversations/:id/files/:fileId/content", read, async (c) => {
    const w = who(c);
    const cid = uuid(c, "id");
    const fid = uuid(c, "fileId");
    if (!uc.filesEnabled) throw storageOff();
    return bytesResponse(await run(uc.fileBytes(w, cid, fid)));
  });
}

/** CR-178 M4 · «Ảnh & tệp» của cuộc nội bộ (GET; đường riêng, không đụng POST tải lên `/files`). */
function attachmentRoutes(r: Routes, h: H, uc: MessagesUsecases): void {
  r.get("/messages/conversations/:id/attachments", h.read, async (c) => {
    const w = h.who(c);
    const cid = h.uuid(c, "id");
    const out = await run(uc.attachments(w, cid, attachQuery(c)));
    h.noStore(c);
    return c.json(out);
  });
}

/** Danh bạ + công ty (CR-148 tải dần; CR-169: lọc công ty, người công ty kết nối, chip công ty). */
function peopleRoutes(r: Routes, h: H, uc: MessagesUsecases): void {
  // Danh bạ «Thành viên» TẢI DẦN (30/lần, trần 50): `own` theo phòng ban rồi tên (CR-148); `all`/công ty theo tên, người có quyền Sổ Hợp Tác.
  r.get("/messages/people", h.read, async (c) => {
    const w = h.who(c);
    const q = parseQuery(c, MsgPeopleQuerySchema);
    const filter = companyFilter(q.company, w.tenantId);
    try {
      const out = await run(uc.people(w, q, filter));
      h.noStore(c);
      return c.json(out);
    } catch (e) {
      if (e instanceof Error && e.message === "BAD_CURSOR")
        throw appError("VALIDATION_ERROR", {
          issues: [{ path: ["cursor"], code: "invalid", message: "cursor" }],
        });
      throw e;
    }
  });
  r.get("/messages/companies", h.read, async (c) => {
    const w = h.who(c);
    const q = parseQuery(c, MsgCompaniesQuerySchema);
    try {
      const out = await run(uc.companies(w, q));
      h.noStore(c);
      return c.json(out);
    } catch (e) {
      if (e instanceof Error && e.message === "BAD_CURSOR")
        throw appError("VALIDATION_ERROR", {
          issues: [{ path: ["cursor"], code: "invalid", message: "cursor" }],
        });
      throw e;
    }
  });
}

export function messagesRoutes(view: PackAccessView, uc: MessagesUsecases): Routes {
  const r = new Hono<PackGuardVars>();
  const h = helpers(view);
  peopleRoutes(r, h, uc);
  conversationRoutes(r, h, uc);
  memberRoutes(r, h, uc);
  messageRoutes(r, h, uc);
  prefRoutes(r, h, uc);
  fileRoutes(r, h, uc);
  attachmentRoutes(r, h, uc);
  searchRoutes(r, h, uc);
  partnerChatRoutes(r, h, uc); // CR-169 · `/messages/partner/:id/**`
  return r;
}
