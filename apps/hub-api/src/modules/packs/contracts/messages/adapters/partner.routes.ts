// CR-169 · lát 3b · `/pack/contracts/messages/partner/:id/**` — cuộc 1-1 với người của công ty đã kết nối: chi tiết, trang tin (cursor `before_seq`), gửi (idempotent `client_id`),
// thu hồi, đã đọc, tải lên + link tải tệp. Guard `read` của gói TRƯỚC khi đọc tham số/thân; external ⇒ 403. Quyền thật ở hàm DEFINER `pmsg_*`: người ngoài cuộc / công ty thứ ba
// ⇒ 404 `MSG_NOT_FOUND` (cùng thân, không lộ); người không thuộc nhóm có quyền Sổ Hợp Tác ⇒ 403 `PACK_FORBIDDEN`. Tệp: một tệp/lần ≤ 20 MB (413 chặn TRƯỚC khi đọc thân), link JSON `{url}`.
import { ATTACH_MAX_BYTES } from "@ai/contracts/attach";
import {
  MarkReadRequestSchema,
  MarkUnreadRequestSchema,
  MsgListQuerySchema,
  PinRequestSchema,
  SendMessageRequestSchema,
} from "@ai/contracts/pack-contracts";
import { bodyLimit } from "hono/body-limit";
import { appError } from "../../../../../lib/errors";
import { parseJson, parseQuery } from "../../../../../lib/http";
import { cleanFileName, fileNameOf } from "../../adapters/upload.routes";
import type { MessagesUsecases } from "../application/messages.usecase";
import { attachQuery } from "./messages-find.routes";
import {
  bytesResponse,
  type H,
  MULTIPART_SLACK,
  notFound,
  type Routes,
  run,
  SeqSchema,
  storageOff,
  tooLarge,
} from "./route.kit";

const P = "/messages/partner/:id";

/** Tin + đã đọc + chi tiết. */
function chatRoutes(r: Routes, h: H, uc: MessagesUsecases): void {
  const { read, who, uuid, noStore } = h;
  r.get(P, read, async (c) => {
    const w = who(c);
    const out = await run(uc.partnerGet(w, uuid(c, "id")));
    noStore(c);
    return c.json(out);
  });
  r.get(`${P}/messages`, read, async (c) => {
    const w = who(c);
    const id = uuid(c, "id");
    const out = await run(uc.partnerMessages(w, id, parseQuery(c, MsgListQuerySchema)));
    noStore(c);
    return c.json(out);
  });
  r.post(`${P}/messages`, read, async (c) => {
    const w = who(c);
    const id = uuid(c, "id");
    const out = await run(uc.partnerSend(w, id, await parseJson(c, SendMessageRequestSchema)));
    return c.json(out.message, out.created ? 201 : 200);
  });
  r.delete(`${P}/messages/:seq`, read, async (c) => {
    const w = who(c);
    const id = uuid(c, "id");
    const seq = SeqSchema.safeParse(c.req.param("seq"));
    if (!seq.success) throw notFound();
    await run(uc.partnerRevoke(w, id, seq.data));
    return c.body(null, 204);
  });
  r.post(`${P}/read`, read, async (c) => {
    const w = who(c);
    const id = uuid(c, "id");
    const body = await parseJson(c, MarkReadRequestSchema);
    return c.json(await run(uc.partnerMarkRead(w, id, body.seq)));
  });
  // CR-190 · ghim / đánh dấu chưa đọc của CHÍNH người gọi; không là đầu cuộc ⇒ 404 `MSG_NOT_FOUND`.
  r.put(`${P}/pin`, read, async (c) => {
    const w = who(c);
    const id = uuid(c, "id");
    const body = await parseJson(c, PinRequestSchema);
    return c.json(await run(uc.partnerPin(w, id, body.pinned)));
  });
  r.put(`${P}/mark-unread`, read, async (c) => {
    const w = who(c);
    const id = uuid(c, "id");
    const body = await parseJson(c, MarkUnreadRequestSchema);
    return c.json(await run(uc.partnerMarkUnread(w, id, body.unread)));
  });
}

/** Tệp: tải lên (multipart `file`) + link tải ngắn hạn. FileBox vắng ⇒ 503. */
function fileRoutes(r: Routes, h: H, uc: MessagesUsecases): void {
  const { read, who, uuid, noStore } = h;
  r.post(
    `${P}/files`,
    read,
    bodyLimit({
      maxSize: ATTACH_MAX_BYTES + MULTIPART_SLACK,
      onError: () => Promise.reject(tooLarge()),
    }),
    async (c) => {
      const w = who(c);
      const id = uuid(c, "id");
      if (!uc.filesEnabled) throw storageOff();
      const form = await c.req.formData().catch(() => null);
      const file = form?.getAll("file").find((f): f is File => f instanceof Blob);
      if (!file) throw appError("VALIDATION_ERROR");
      if (file.size > ATTACH_MAX_BYTES) throw tooLarge();
      const name = cleanFileName(fileNameOf(file));
      const bytes = new Uint8Array(await file.arrayBuffer());
      return c.json(await run(uc.partnerUpload(w, id, { name, bytes })), 201);
    },
  );
  r.get(`${P}/files/:fileId/link`, read, async (c) => {
    const w = who(c);
    const id = uuid(c, "id");
    const fid = uuid(c, "fileId");
    if (!uc.filesEnabled) throw storageOff();
    const url = await run(uc.partnerFileLink(w, id, fid));
    noStore(c);
    return c.json({ url });
  });
  r.get(`${P}/files/:fileId/content`, read, async (c) => {
    const w = who(c);
    const id = uuid(c, "id");
    const fid = uuid(c, "fileId");
    if (!uc.filesEnabled) throw storageOff();
    return bytesResponse(await run(uc.partnerFileBytes(w, id, fid)));
  });
}

/** CR-178 M4 · «Ảnh & tệp» của cuộc `partner` (đọc được cả sau ngắt kết nối). */
function attachmentRoutes(r: Routes, h: H, uc: MessagesUsecases): void {
  r.get(`${P}/attachments`, h.read, async (c) => {
    const w = h.who(c);
    const id = h.uuid(c, "id");
    const out = await run(uc.partnerAttachments(w, id, attachQuery(c)));
    h.noStore(c);
    return c.json(out);
  });
}

export function partnerChatRoutes(r: Routes, h: H, uc: MessagesUsecases): void {
  chatRoutes(r, h, uc);
  attachmentRoutes(r, h, uc);
  fileRoutes(r, h, uc);
}
