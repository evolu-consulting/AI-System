// HUB-FR-44 · HUB-FR-101 · X2b2-R01–R04, R14, D7, D8 · file đính kèm tin phòng phía `rooms` (plan X2b2 §6.1): luật D8 +
// chuẩn hoá id ở biên, gắn trong tx gửi, ref ở trang/tin trùng/`room.message`. SQL ở `attachments/room-files.ts`.
import type { SendRoomMessageRequest } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { validationError } from "../../../lib/http";
import {
  bindRoomMessageFiles,
  checkRoomSendable,
  normalizeAttachmentIds,
  roomFileRefs,
} from "../../attachments/room-files";
import type { Me } from "../manage/rooms.repo";
import type { RoomMessageRow } from "../rooms.map";
import { roomFilesAllowed } from "../rooms.rules";
import { findByClientId } from "./messages.repo";

/**
 * D8 · RV-7 · validate `attachment_ids` sau zod: `!…` timeline + engine P-a ⇒ 400 (path `attachment_ids`, `unsupported`);
 * chuẩn hoá chữ thường, trùng sau chuẩn hoá ⇒ 400. Không id ⇒ trả nguyên body.
 */
export function filesBody(
  body: SendRoomMessageRequest,
  processEngine: boolean,
): SendRoomMessageRequest {
  const ids = body.attachment_ids;
  if (!ids) return body;
  const allowed = roomFilesAllowed({
    content: body.content,
    processEngine,
    ...(body.flow_id !== undefined && { flowId: body.flow_id }),
    ...(body.answer_run_id !== undefined && { answerRunId: body.answer_run_id }),
  });
  if (!allowed)
    throw validationError([{ path: ["attachment_ids"], code: "custom", message: "unsupported" }]);
  return { ...body, attachment_ids: normalizeAttachmentIds(ids) };
}

/** R14 · gắn ref file vào các hàng tin (một câu phụ; không hàng ⇒ không câu nào). */
export async function withRefs(
  tx: Tx,
  me: Me,
  roomId: string,
  rows: readonly RoomMessageRow[],
): Promise<RoomMessageRow[]> {
  if (rows.length === 0) return [...rows];
  const refs = await roomFileRefs(tx, me, { roomId, messageIds: rows.map((r) => r.id) });
  if (refs.size === 0) return [...rows];
  return rows.map((r) => {
    const a = refs.get(r.id);
    return a ? { ...r, attachments: a } : r;
  });
}

/** Tin trùng `client_msg_id` ⇒ trả kèm ref như lần đầu (không gắn lại). */
export async function withRefsOne(tx: Tx, me: Me, row: RoomMessageRow): Promise<RoomMessageRow> {
  const [out] = await withRefs(tx, me, row.roomId, [row]);
  return out ?? row;
}

/** R01/D7 · ngay sau INSERT tin (cùng tx): gắn `ids` (thiếu ⇒ 404, ROLLBACK). Không id ⇒ không câu nào. */
export async function bindMessageFiles(
  tx: Tx,
  me: Me,
  row: RoomMessageRow,
  ids: readonly string[] | undefined,
): Promise<RoomMessageRow> {
  if (!ids || ids.length === 0) return row;
  const p = { roomId: row.roomId, messageId: row.id, ids };
  return { ...row, attachments: await bindRoomMessageFiles(tx, me, p) };
}

/**
 * D7 · kiểm trước (ngoài tx gửi, scope user, một lượt đọc): trùng `client_msg_id` ⇒ tin cũ kèm ref (200, kiểm file bỏ qua);
 * không ⇒ `checkRoomSendable` (404 `ATTACHMENT_NOT_FOUND{ids}`) rồi null.
 */
export async function preSendFiles(
  tx: Tx,
  me: Me,
  roomId: string,
  body: SendRoomMessageRequest,
): Promise<RoomMessageRow | null> {
  const dup = await findByClientId(tx, me, roomId, body.client_msg_id);
  if (dup) return withRefsOne(tx, me, dup);
  await checkRoomSendable(tx, me, body.attachment_ids ?? []);
  return null;
}
