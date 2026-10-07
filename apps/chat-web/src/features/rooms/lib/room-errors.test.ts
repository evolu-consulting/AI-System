// X2a · mã lỗi phòng → key i18n; mọi mã contract có chuỗi trong cả vi/en.
import { describe, expect, test } from "bun:test";
import { CHAT_ROOM_ERROR_CODES } from "@ai/contracts/chat";
import { ApiError } from "~/lib/http";
import en from "../../../../../../packages/i18n/locales/chat/en.json";
import vi from "../../../../../../packages/i18n/locales/chat/vi.json";
import { isRoomNotFound, roomErrorKey, roomErrorKeyOf } from "./room-errors";

describe("roomErrorKey", () => {
  test("mọi mã CHAT_ROOM_ERRORS + VALIDATION_ERROR có chuỗi VI/EN", () => {
    for (const code of [...CHAT_ROOM_ERROR_CODES, "VALIDATION_ERROR"]) {
      const key = roomErrorKey(code).replace("rtErr.", "");
      expect(key).toBe(code);
      expect((vi.rtErr as Record<string, string>)[key]).toBeTruthy();
      expect((en.rtErr as Record<string, string>)[key]).toBeTruthy();
    }
  });
  test("mã lạ / không có → unknown", () => {
    expect(roomErrorKey("WAT")).toBe("rtErr.unknown");
    expect(roomErrorKey(undefined)).toBe("rtErr.unknown");
    expect(roomErrorKeyOf(new Error("x"))).toBe("rtErr.unknown");
  });
  test("ApiError → key theo code; 404 ROOM_NOT_FOUND nhận ra", () => {
    const err = new ApiError(409, "ROOM_FULL", "Room is full");
    expect(roomErrorKeyOf(err)).toBe("rtErr.ROOM_FULL");
    expect(isRoomNotFound(new ApiError(404, "ROOM_NOT_FOUND", "x"))).toBe(true);
    expect(isRoomNotFound(err)).toBe(false);
  });
});
