// HUB-FR-96 · HUB-FR-97 · HUB-FR-98 · HUB-FR-100 · luật thuần phòng chat (X2a plan §8; spec X2a-R04…R18). Không I/O.
import { ROOM_MEMBERS_MAX, ROOM_PREVIEW_MAX } from "@ai/contracts/chat";

export type RoomKind = "dm" | "group";
export type RoomRole = "owner" | "member";
export type RoomAction =
  | "view"
  | "send"
  | "read"
  | "rename"
  | "delete"
  | "add"
  | "remove"
  | "transfer"
  | "leave"
  | "hide";
export type RoomActionError = "DM_IMMUTABLE" | "GROUP_NOT_HIDEABLE" | "NOT_ROOM_OWNER";

const DM_ALLOWED: ReadonlySet<RoomAction> = new Set(["view", "send", "read", "hide"]);
const OWNER_ONLY: ReadonlySet<RoomAction> = new Set([
  "rename",
  "delete",
  "add",
  "remove",
  "transfer",
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Khoá DM duy nhất (R05): hai uuid chữ thường, tăng dần, nối ":". */
export function dmKey(a: string, b: string): string {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()].sort();
  return `${x}:${y}`;
}

/** R06/R09 · thứ tự kiểm: DM bất biến → ẩn nhóm → việc của chủ. */
export function roomActionError(
  kind: RoomKind,
  myRole: RoomRole | null,
  action: RoomAction,
): RoomActionError | null {
  if (kind === "dm") return DM_ALLOWED.has(action) ? null : "DM_IMMUTABLE";
  if (action === "hide") return "GROUP_NOT_HIDEABLE";
  if (OWNER_ONLY.has(action) && myRole !== "owner") return "NOT_ROOM_OWNER";
  return null;
}

/** R08 · bỏ trùng + chính mình; `full` ⇔ tổng (gồm chủ) > 50. */
export function planCreateGroup(
  selfId: string,
  memberIds: readonly string[],
): { members: string[]; full: boolean } {
  const members = [...new Set(memberIds)].filter((id) => id !== selfId);
  return { members, full: members.length + 1 > ROOM_MEMBERS_MAX };
}

/** R08/R09 · bỏ trùng + đã là thành viên; `requestedTotal` = số thành viên sau khi thêm. */
export function planAddMembers(
  currentIds: readonly string[],
  requested: readonly string[],
): { toAdd: string[]; full: boolean; requestedTotal: number } {
  const current = new Set(currentIds);
  const toAdd = [...new Set(requested)].filter((id) => !current.has(id));
  const requestedTotal = current.size + toAdd.length;
  return { toAdd, full: requestedTotal > ROOM_MEMBERS_MAX, requestedTotal };
}

/** R10 · chủ một mình rời ⇒ xoá phòng; chủ còn người khác ⇒ phải chuyển chủ trước. */
export function leaveOutcome(
  myRole: RoomRole,
  activeCount: number,
): "leave" | "delete" | "OWNER_MUST_TRANSFER" {
  if (myRole !== "owner") return "leave";
  return activeCount <= 1 ? "delete" : "OWNER_MUST_TRANSFER";
}

/** R18 · mốc đọc chỉ tăng, không vượt `lastSeq`; null = không đổi (không sự kiện). */
export function clampReadSeq(requested: number, current: number, lastSeq: number): number | null {
  const next = Math.min(requested, lastSeq);
  return next > current ? next : null;
}

/** R17 · D5. */
export function unreadOf(lastSeq: number, lastReadSeq: number): number {
  return Math.max(0, lastSeq - lastReadSeq);
}

/** D6 · vào phòng ⇒ mốc đọc = `last_seq` lúc vào. */
export function joinReadSeq(lastSeq: number): number {
  return lastSeq;
}

/** R15 · gộp khoảng trắng, cắt theo code point (không vỡ emoji). */
export function previewOf(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  return Array.from(flat).slice(0, ROOM_PREVIEW_MAX).join("");
}

/** Cursor `GET /rooms` = base64url(JSON `[iso, id]`) của khoá `(last_activity_at, id)`. */
export function encodeRoomCursor(k: { at: Date; id: string }): string {
  return Buffer.from(JSON.stringify([k.at.toISOString(), k.id])).toString("base64url");
}

/** Chuỗi hỏng/lạ ⇒ null (route trả 400). Chỉ nhận đúng dạng do `encodeRoomCursor` sinh. */
export function decodeRoomCursor(s: string): { at: Date; id: string } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const [iso, id] = raw as unknown[];
  if (typeof iso !== "string" || typeof id !== "string" || !UUID_RE.test(id)) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime()) || at.toISOString() !== iso) return null;
  return encodeRoomCursor({ at, id }) === s ? { at, id } : null;
}
