// CR-178 · luật thuần của «Ảnh & tệp» (M4) và tìm tin (M3): con trỏ phân trang, dựng DTO. Không I/O.
import {
  attachKindOf,
  type FileRef,
  type MsgAttachKind,
  type MsgAttachment,
} from "@ai/contracts/pack-contracts";
import type { RawAttachment } from "./messages.ports";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Con trỏ «Ảnh & tệp» = (seq tin, id tệp) của dòng cuối, base64url JSON. Hỏng ⇒ null (route trả 400). */
export function encodeAttachCursor(c: { seq: number; id: string }): string {
  return Buffer.from(JSON.stringify([c.seq, c.id])).toString("base64url");
}
export function decodeAttachCursor(s: string): { seq: number; id: string } | null {
  try {
    const v: unknown = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
    if (!Array.isArray(v) || v.length !== 2) return null;
    const [seq, id] = v;
    return typeof seq === "number" &&
      Number.isSafeInteger(seq) &&
      seq >= 1 &&
      typeof id === "string" &&
      UUID_RE.test(id)
      ? { seq, id }
      : null;
  } catch {
    return null;
  }
}

const isoOf = (raw: string): string => new Date(raw).toISOString();

export function attachmentOf(r: RawAttachment, senderName: string): MsgAttachment {
  return {
    file: { id: r.id, name: r.name, mime: r.mime as FileRef["mime"], size: Number(r.size) },
    kind: attachKindOf(r.mime),
    sender_id: r.sender_id,
    sender_name: senderName,
    seq: Number(r.seq),
    at: isoOf(r.at),
  };
}

export const kindOrNull = (k: MsgAttachKind | undefined): MsgAttachKind | null => k ?? null;
