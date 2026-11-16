// CR-178 · phần dùng chung của route «Ảnh & tệp» (nội bộ + `partner`): đọc query + con trỏ; con trỏ hỏng ⇒ 400 `VALIDATION_ERROR` (path `cursor`).
import { MsgAttachmentsQuerySchema, MsgSearchQuerySchema } from "@ai/contracts/pack-contracts";
import { appError } from "../../../../../lib/errors";
import { parseQuery } from "../../../../../lib/http";
import { decodeAttachCursor } from "../application/messages.find";
import { decodeSearchCursor } from "../application/messages.search";
import type { MessagesUsecases } from "../application/messages.usecase";
import { type Ctx, type H, type Routes, run } from "./route.kit";

export function attachQuery(c: Ctx) {
  const q = parseQuery(c, MsgAttachmentsQuerySchema);
  const cur = q.cursor ? decodeAttachCursor(q.cursor) : null;
  if (q.cursor && !cur)
    throw appError("VALIDATION_ERROR", {
      issues: [{ path: ["cursor"], code: "invalid", message: "cursor" }],
    });
  return { kind: q.kind, limit: q.limit, cur };
}

/** CR-178 M3 · `GET /messages/search?q=&conversation_id=&cursor=&limit=` (guard `read` của gói; `q` 2–100 ký tự; con trỏ hỏng ⇒ 400). */
export function searchRoutes(r: Routes, h: H, uc: MessagesUsecases): void {
  r.get("/messages/search", h.read, async (c) => {
    const w = h.who(c);
    const q = parseQuery(c, MsgSearchQuerySchema);
    const cur = q.cursor ? decodeSearchCursor(q.cursor) : null;
    if (q.cursor && !cur)
      throw appError("VALIDATION_ERROR", {
        issues: [{ path: ["cursor"], code: "invalid", message: "cursor" }],
      });
    const out = await run(
      uc.search(w, { q: q.q, conversationId: q.conversation_id ?? null, cur, limit: q.limit }),
    );
    h.noStore(c);
    return c.json(out);
  });
}
