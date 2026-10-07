// X2a · mã lỗi phòng → key i18n `rtErr.*` (plan-frontend-i18n). Mã lạ → `rtErr.unknown`; message của server không hiện ra.
import { CHAT_ROOM_ERROR_CODES } from "@ai/contracts/chat";
import { ApiError } from "~/lib/http";

const KNOWN: ReadonlySet<string> = new Set([...CHAT_ROOM_ERROR_CODES, "VALIDATION_ERROR"]);

export function roomErrorKey(code: string | undefined): string {
  return code && KNOWN.has(code) ? `rtErr.${code}` : "rtErr.unknown";
}

export function roomErrorKeyOf(err: unknown): string {
  return roomErrorKey(err instanceof ApiError ? err.code : undefined);
}

/** 404 ROOM_NOT_FOUND: màn phòng chuyển sang `RoomNotFound`. */
export function isRoomNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.code === "ROOM_NOT_FOUND";
}
