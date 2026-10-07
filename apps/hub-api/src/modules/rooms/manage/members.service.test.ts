// HUB-FR-98 · `removeMember`: `:user_id` không uuid / chính mình ⇒ 400 trước khi chạm DB (plan §3).
import { describe, expect, test } from "bun:test";
import type { AuthUser } from "../../../lib/auth.middleware";
import { isAppError } from "../../../lib/errors";
import { MembersService } from "./members.service";
import type { RoomsService } from "./rooms.service";

const ME = "11111111-1111-4111-8111-111111111111";
const ROOM = "22222222-2222-4222-8222-222222222222";
const user = { userId: ME, tenantId: "33333333-3333-4333-8333-333333333333" } as AuthUser;
const noDb = {
  commit: () => {
    throw new Error("không được chạm DB");
  },
} as unknown as RoomsService;

const codeOf = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (err) {
    return isAppError(err) ? err.code : "other";
  }
};

describe("MembersService.removeMember", () => {
  const svc = new MembersService(noDb);
  test("`:user_id` không uuid ⇒ VALIDATION_ERROR", () => {
    expect(codeOf(() => svc.removeMember(user, ROOM, "khong-phai-uuid"))).toBe("VALIDATION_ERROR");
  });
  test("bớt chính mình ⇒ VALIDATION_ERROR (dùng leave)", () => {
    expect(codeOf(() => svc.removeMember(user, ROOM, ME))).toBe("VALIDATION_ERROR");
  });
  test("uuid người khác ⇒ đi tiếp xuống transaction", () => {
    expect(codeOf(() => svc.removeMember(user, ROOM, ROOM))).toBe("other");
  });
});
