// CR-178 · phần dùng chung của route «Ảnh & tệp» (nội bộ + `partner`): đọc query + con trỏ; con trỏ hỏng ⇒ 400 `VALIDATION_ERROR` (path `cursor`).
import { MsgAttachmentsQuerySchema } from "@ai/contracts/pack-contracts";
import { appError } from "../../../../../lib/errors";
import { parseQuery } from "../../../../../lib/http";
import { decodeAttachCursor } from "../application/messages.find";
import type { Ctx } from "./route.kit";

export function attachQuery(c: Ctx) {
  const q = parseQuery(c, MsgAttachmentsQuerySchema);
  const cur = q.cursor ? decodeAttachCursor(q.cursor) : null;
  if (q.cursor && !cur)
    throw appError("VALIDATION_ERROR", {
      issues: [{ path: ["cursor"], code: "invalid", message: "cursor" }],
    });
  return { kind: q.kind, limit: q.limit, cur };
}
