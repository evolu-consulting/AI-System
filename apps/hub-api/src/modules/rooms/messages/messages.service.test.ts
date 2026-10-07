// HUB-FR-96 · `send`: 23505 (`room_messages_client_uq`, lưới cuối gửi trùng) ⇒ chạy lại transaction đúng 1 lần; lỗi khác
// không chạy lại (plan-db §5 "Gửi trùng song song").
import { describe, expect, test } from "bun:test";
import type { AuthUser } from "../../../lib/auth.middleware";
import type { RoomsService } from "../manage/rooms.service";
import { MessagesService } from "./messages.service";

const ROOM = "22222222-2222-4222-8222-222222222222";
const user = {
  userId: "11111111-1111-4111-8111-111111111111",
  tenantId: "33333333-3333-4333-8333-333333333333",
} as AuthUser;
const body = { content: "x", client_msg_id: "44444444-4444-4444-8444-444444444444" };
const ok = { message: { id: "m" }, created: false };

/** `commit` giả: ném lần lượt các lỗi trong `fails`, sau đó trả `ok`. */
function fakeRooms(fails: unknown[]): { svc: RoomsService; calls: () => number } {
  let n = 0;
  const svc = {
    commit: async () => {
      const err = fails[n++];
      if (err !== undefined) throw err;
      return ok;
    },
  } as unknown as RoomsService;
  return { svc, calls: () => n };
}

describe("MessagesService.send", () => {
  test("23505 (bọc ở cause) ⇒ chạy lại 1 lần, trả kết quả lần 2", async () => {
    const f = fakeRooms([{ cause: { code: "23505" } }]);
    expect(await new MessagesService(f.svc).send(user, ROOM, body)).toEqual(ok as never);
    expect(f.calls()).toBe(2);
  });
  test("23505 hai lần ⇒ ném, không lặp vô hạn", async () => {
    const f = fakeRooms([{ code: "23505" }, { code: "23505" }]);
    await expect(new MessagesService(f.svc).send(user, ROOM, body)).rejects.toEqual({
      code: "23505",
    });
    expect(f.calls()).toBe(2);
  });
  test("lỗi khác ⇒ ném ngay, không chạy lại", async () => {
    const f = fakeRooms([{ code: "40P01" }]);
    await expect(new MessagesService(f.svc).send(user, ROOM, body)).rejects.toEqual({
      code: "40P01",
    });
    expect(f.calls()).toBe(1);
  });
});
