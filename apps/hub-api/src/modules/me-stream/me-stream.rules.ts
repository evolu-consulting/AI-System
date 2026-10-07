// HUB-FR-99 · luật thuần `/me/stream` (X2a plan §7 bảng `Last-Event-ID`, §8; spec-isolation §1). Không I/O.
import { STREAM_EVENT_ID_RE } from "@ai/contracts/chat";
import { compareStreamId } from "../runner/runner.rules";

/** `XINFO STREAM`: id cuối đã sinh + id lớn nhất đã bị cắt (Redis 7). */
export type StreamInfo = { lastGenerated: string; maxDeleted: string };

/** `Last-Event-ID` hợp lệ ⇒ chính nó; vắng/sai định dạng ⇒ null. */
export function parseStreamId(raw: string | null | undefined): string | null {
  return typeof raw === "string" && STREAM_EVENT_ID_RE.test(raw) ? raw : null;
}

/**
 * Vắng id ⇒ `tail` (không replay). Có id: key không còn / id > `lastGenerated` / id < `maxDeleted` ⇒ `reset`
 * (không còn bảo đảm không mất tin); còn lại ⇒ `replay` từ sau id.
 */
export function resumeDecision(
  lastId: string | null,
  info: StreamInfo | null,
): "tail" | "replay" | "reset" {
  if (lastId === null) return "tail";
  if (!info) return "reset";
  if (compareStreamId(lastId, info.lastGenerated) > 0) return "reset";
  if (compareStreamId(lastId, info.maxDeleted) < 0) return "reset";
  return "replay";
}

/** Kết nối phải đóng khi vượt `max` (cũ nhất trước — phần tử đầu). */
export function evictOldest<T>(conns: readonly T[], max: number): T[] {
  return conns.slice(0, Math.max(0, conns.length - max));
}
