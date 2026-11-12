// CR-132 M4 · HD-MSG-01..12 · luật thuần chọn người nhận + khung sự kiện `msg.*`: khử trùng, một người một khung, khung hợp contract, không người nhận ⇒ không khung.
import { describe, expect, it } from "bun:test";
import { MeStreamMsgEventSchema, type Message } from "@ai/contracts/pack-contracts";
import {
  conversationFrames,
  deletedFrames,
  type MsgFrame,
  newFrames,
  readFrames,
} from "./messages.events";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const C = U(100);
const msg: Message = {
  id: U(50),
  seq: 3,
  conversation_id: C,
  sender_id: U(1),
  client_id: U(51),
  body: "chào",
  files: [],
  at: "2026-11-12T10:00:00.000Z",
  deleted: false,
};
const valid = (f: MsgFrame) =>
  MeStreamMsgEventSchema.safeParse({ event: f.event, data: f.data }).success;

describe("messages.events · khung msg.new / msg.deleted / msg.read", () => {
  it("mọi thành viên (kể cả người gửi), khử trùng, một khung, đúng contract", () => {
    const fs = newFrames(C, msg, [U(1), U(2), U(2), U(3)]);
    expect(fs).toHaveLength(1);
    expect(fs[0]?.userIds).toEqual([U(1), U(2), U(3)]);
    expect(fs.every(valid)).toBe(true);
    expect(deletedFrames(C, 3, [U(1), U(2)]).every(valid)).toBe(true);
    const r = readFrames(C, U(2), 3, [U(1), U(2)]);
    expect(r[0]).toMatchObject({ event: "msg.read", data: { user_id: U(2), seq: 3 } });
    expect(r.every(valid)).toBe(true);
  });

  it("không còn người nhận ⇒ không khung (không gọi Redis)", () => {
    expect(newFrames(C, msg, [])).toEqual([]);
    expect(deletedFrames(C, 1, [])).toEqual([]);
  });
});

describe("messages.events · msg.conversation", () => {
  it("người vào = added, người ra = removed, người còn lại = updated; mỗi người MỘT khung", () => {
    const fs = conversationFrames(C, {
      added: [U(4)],
      removed: [U(5)],
      rest: [U(1), U(4), U(5), U(2)],
    });
    expect(fs.map((f) => [f.data, f.userIds])).toEqual([
      [{ conversation_id: C, change: "added" }, [U(4)]],
      [{ conversation_id: C, change: "removed" }, [U(5)]],
      [{ conversation_id: C, change: "updated" }, [U(1), U(2)]],
    ]);
    expect(fs.every(valid)).toBe(true);
  });

  it("chỉ có rest ⇒ một khung updated; rỗng ⇒ không khung", () => {
    expect(conversationFrames(C, { rest: [U(1), U(1)] })).toHaveLength(1);
    expect(conversationFrames(C, {})).toEqual([]);
  });
});
