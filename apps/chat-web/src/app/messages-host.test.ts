// CR-169 · gắn host Tin nhắn cho chat-web: đủ cổng tiêm; luồng sự kiện đi qua bus msg-frames.
import { describe, expect, test } from "bun:test";
import { dispatchMsgFrame } from "~/features/realtime/msg-frames";
import { messagesHostConfig } from "./messages-host";

describe("CR-169 · messagesHostConfig", () => {
  const h = messagesHostConfig();
  test("đủ cổng tiêm", () => {
    if (!h) throw new Error("host null");
    for (const k of ["api", "subscribe", "myId", "useScope", "useOwnCompany", "ui"] as const)
      expect(h[k]).toBeDefined();
    for (const k of ["cn", "Skeleton", "Dialog", "DialogContent", "confirm"] as const)
      expect(h.ui[k]).toBeDefined();
  });
  test("subscribe nhận msg.new từ bus realtime và huỷ được", () => {
    if (!h) throw new Error("host null");
    const got: string[] = [];
    const off = h.subscribe("msg.new", (f) => got.push(f.data));
    dispatchMsgFrame({ event: "msg.new", data: "1" });
    off();
    dispatchMsgFrame({ event: "msg.new", data: "2" });
    expect(got).toEqual(["1"]);
  });
});
