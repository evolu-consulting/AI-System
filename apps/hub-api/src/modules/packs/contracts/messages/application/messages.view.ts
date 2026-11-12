// CR-132 M3 · HD-MSG-01..12 · luật thuần dựng DTO của contract từ dòng thô SQL + tên người (không I/O): tóm tắt hội thoại, chi tiết, tin, con trỏ phân trang.
import {
  type ConversationDetail,
  type ConversationSummary,
  type Message,
  messagePreview,
} from "@ai/contracts/pack-contracts";
import { capUnread } from "../domain/messages.rules";
import type { RawConversation, RawMessage } from "./messages.ports";

export type PersonInfo = { name: string; active: boolean };
export type People = ReadonlyMap<string, PersonInfo>;

const isoOf = (raw: string): string => new Date(raw).toISOString();
/** Xem trước = hàm chung của contract (client cập nhật theo `msg.new` cùng quy ước). */
export const previewOf = messagePreview;

/** Id người cần tra tên cho một nhóm dòng: người gửi tin cuối, người còn lại của 1-1, thành viên (chi tiết). */
export function personIdsOf(rows: readonly RawConversation[]): string[] {
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.peer_id) ids.add(r.peer_id);
    if (r.last) ids.add(r.last.sender_id);
    for (const m of r.members ?? []) ids.add(m.user_id);
  }
  return [...ids];
}

export function summaryOf(r: RawConversation, people: People): ConversationSummary {
  const peer = r.peer_id ? people.get(r.peer_id) : undefined;
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    peer:
      r.kind === "direct" && r.peer_id
        ? { id: r.peer_id, name: peer?.name ?? "", active: peer?.active ?? false }
        : null,
    member_count: r.member_count,
    last_message: r.last
      ? {
          seq: r.last.seq,
          sender_id: r.last.sender_id,
          sender_name: people.get(r.last.sender_id)?.name ?? "",
          preview: r.last.deleted ? "" : previewOf(r.last.preview),
          has_files: r.last.has_files && !r.last.deleted,
          deleted: r.last.deleted,
          at: isoOf(r.last.at),
        }
      : null,
    unread: capUnread(r.unread, "conversation"),
    last_at: isoOf(r.last_at),
  };
}

export function detailOf(r: RawConversation, people: People): ConversationDetail {
  return {
    ...summaryOf(r, people),
    my_role: r.my_role,
    members: (r.members ?? []).map((m) => ({
      user_id: m.user_id,
      name: people.get(m.user_id)?.name ?? "",
      role: m.role,
      last_read_seq: m.last_read_seq,
      active: people.get(m.user_id)?.active ?? false,
    })),
  };
}

export function messageOf(m: RawMessage, conversationId: string): Message {
  return {
    id: m.id,
    seq: m.seq,
    conversation_id: conversationId,
    sender_id: m.sender_id,
    client_id: m.client_id,
    body: m.deleted ? "" : m.body,
    files: m.deleted ? [] : (m.files as Message["files"]),
    at: isoOf(m.at),
    deleted: m.deleted,
  };
}

/** Con trỏ danh sách hội thoại = `last_at` (ISO µs của PG) + id, base64url JSON. Hỏng ⇒ null (use case trả 400). */
export function encodeCursor(c: { at: string; id: string }): string {
  return Buffer.from(JSON.stringify([c.at, c.id])).toString("base64url");
}
const CURSOR_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function decodeCursor(s: string): { at: string; id: string } | null {
  try {
    const v: unknown = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
    if (!Array.isArray(v) || v.length !== 2) return null;
    const [at, id] = v;
    return typeof at === "string" &&
      typeof id === "string" &&
      CURSOR_RE.test(at) &&
      UUID_RE.test(id)
      ? { at, id }
      : null;
  } catch {
    return null;
  }
}
