// HUB-FR-97 · HUB-FR-98 · `guard`: thứ tự kiểm plan §3 (404 → 409 → 403), không phải thành viên ⇒ ROOM_NOT_FOUND.
import { describe, expect, test } from "bun:test";
import { isAppError } from "../../../lib/errors";
import { guard } from "./rooms.service";

const codeOf = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (err) {
    return isAppError(err) ? err.code : "other";
  }
};

describe("guard", () => {
  test("không phải thành viên ⇒ ROOM_NOT_FOUND với mọi việc", () => {
    expect(codeOf(() => guard(null, "view"))).toBe("ROOM_NOT_FOUND");
    expect(codeOf(() => guard(null, "rename"))).toBe("ROOM_NOT_FOUND");
  });

  test("DM: đổi tên/xoá ⇒ DM_IMMUTABLE; xem ⇒ qua", () => {
    const dm = { kind: "dm", role: "member" } as const;
    expect(codeOf(() => guard(dm, "rename"))).toBe("DM_IMMUTABLE");
    expect(codeOf(() => guard(dm, "delete"))).toBe("DM_IMMUTABLE");
    expect(guard(dm, "view")).toEqual(dm);
  });

  test("nhóm: thành viên thường đổi tên/xoá ⇒ NOT_ROOM_OWNER; chủ ⇒ qua", () => {
    expect(codeOf(() => guard({ kind: "group", role: "member" }, "delete"))).toBe("NOT_ROOM_OWNER");
    expect(codeOf(() => guard({ kind: "group", role: "owner" }, "rename"))).toBeNull();
  });
});
