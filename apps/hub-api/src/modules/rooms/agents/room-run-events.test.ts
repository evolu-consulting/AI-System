import { describe, expect, test } from "bun:test";
import { parseMeStreamRunEvent, type RoomMessage } from "@ai/contracts/chat";
import { USER_STREAM_FIELD } from "../../../lib/user-stream";
import { parseFields } from "../../me-stream/user-stream-reader";
import { runStartedEvents } from "./room-run-events";

const U = (n: number) => `a2bb0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const trigger: RoomMessage = {
  id: U(1),
  room_id: U(2),
  seq: 3,
  sender_type: "user",
  sender: { id: U(4), display_name: "Lan" },
  content: "@hoadon kiểm tra",
  client_msg_id: U(5),
  created_at: "2026-10-08T00:00:00.000Z",
  flow_id: U(6),
  placement: "main",
};
const started = {
  roomId: U(2),
  runId: U(7),
  flowId: U(6),
  trigger,
  agent: { key: "hoadon", name: { vi: "Hoá đơn", en: "Invoice" } },
};

describe("runStartedEvents (X2b plan §7)", () => {
  test("một sự kiện cho mọi thành viên (bỏ trùng), payload hợp lệ contract, không nội dung tin", () => {
    const [ev, ...rest] = runStartedEvents(started, [U(4), U(8), U(4)]);
    expect(rest).toEqual([]);
    expect(ev?.userIds).toEqual([U(4), U(8)]);
    const raw = JSON.stringify(ev?.data);
    expect(parseMeStreamRunEvent("room.run_started", raw)).not.toBeNull();
    expect(raw).not.toContain("kiểm tra");
  });

  test("không người nhận ⇒ không sự kiện", () => {
    expect(runStartedEvents(started, [])).toEqual([]);
  });

  test("reader `/me/stream` nhận sự kiện run (D10), vẫn bỏ sự kiện lạ", () => {
    const [ev] = runStartedEvents({ ...started, agent: null }, [U(4)]);
    const body = JSON.stringify({ event: ev?.event, data: ev?.data });
    expect(parseFields([USER_STREAM_FIELD, body])?.event).toBe("room.run_started");
    const bad = JSON.stringify({ event: "room.run_exploded", data: ev?.data });
    expect(parseFields([USER_STREAM_FIELD, bad])).toBeNull();
  });
});
