// HUB-FR-44 · HUB-FR-101 · X2b2-R05–R07, D3 · unit test luật thuần file phòng (bổ sung test khoá X2b2/rules).
import { describe, expect, it } from "bun:test";
import {
  attachmentRefs,
  canReadAttachment,
  isUnbound,
  pickRoomRunFiles,
  type RoomFileRow,
  roomFileWindow,
} from "./room-files.rules";

const row = (id: string, msg: string, seq: number, position: number): RoomFileRow => ({
  id,
  roomMessageId: msg,
  seq,
  position,
  safeName: `${id}.txt`,
  mime: "text/plain",
  size: 10,
  sha256: "a".repeat(64),
});

describe("room-files.rules", () => {
  it("pickRoomRunFiles · không đổi mảng vào; 11 file cùng tin ⇒ 10 theo position", () => {
    const rows = Array.from({ length: 11 }, (_, i) => row(`f${10 - i}`, "m1", 1, 10 - i));
    const copy = [...rows];
    const got = pickRoomRunFiles(rows, { triggerMessageId: "m1" });
    expect(rows).toEqual(copy);
    expect(got.map((r) => r.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("roomFileWindow · trùng trong main/thread chỉ giữ lần đầu", () => {
    expect(
      roomFileWindow({ triggerId: "t", main: [{ id: "a" }, { id: "a" }], thread: [{ id: "t" }] }),
    ).toEqual(["t", "a"]);
  });

  it("canReadAttachment · phòng không xét chủ; hội thoại không xét thành viên", () => {
    const v = { userId: "u2", roomMember: true, roomDeleted: false };
    expect(canReadAttachment({ roomId: "r", ownerId: "u1", conversationDeleted: true }, v)).toBe(
      true,
    );
    expect(canReadAttachment({ roomId: null, ownerId: "u2", conversationDeleted: false }, v)).toBe(
      true,
    );
  });

  it("isUnbound · gắn cả hai ⇒ false", () => {
    expect(isUnbound({ messageId: "m", roomId: "r" })).toBe(false);
  });

  it("attachmentRefs · giữ thứ tự", () => {
    const r = (id: string) => ({
      id,
      filename: id,
      mime: "text/plain" as const,
      size: 1,
      purgedAt: null,
    });
    expect(attachmentRefs([r("b"), r("a")])?.map((x) => x.id)).toEqual(["b", "a"]);
  });
});
