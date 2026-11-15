// CR-169 · gắn host Tin nhắn: khung msg.*/cc.link tới đúng người nghe; huỷ đăng ký; nối lại báo mọi bên.
import { describe, expect, test } from "bun:test";
import {
  dispatchMsgFrame,
  isMessagesFrame,
  notifyMsgReconnected,
  subscribeMsgFrames,
} from "./msg-frames";

describe("CR-169 · msg-frames", () => {
  test("nhận diện khung của gói Tin nhắn", () => {
    expect(isMessagesFrame("msg.new")).toBe(true);
    expect(isMessagesFrame("cc.link")).toBe(true);
    expect(isMessagesFrame("room.message")).toBe(false);
    expect(isMessagesFrame("stream.reset")).toBe(false);
  });
  test("chuyển đúng sự kiện, huỷ thì dừng", () => {
    const got: string[] = [];
    const off = subscribeMsgFrames("msg.new", (f) => got.push(f.data));
    dispatchMsgFrame({ event: "msg.new", data: "a" });
    dispatchMsgFrame({ event: "msg.read", data: "b" });
    off();
    dispatchMsgFrame({ event: "msg.new", data: "c" });
    expect(got).toEqual(["a"]);
  });
  test("nối lại báo người đăng ký, huỷ rồi thì không", () => {
    let n = 0;
    const off = subscribeMsgFrames(
      "msg.new",
      () => {},
      () => n++,
    );
    notifyMsgReconnected();
    off();
    notifyMsgReconnected();
    expect(n).toBe(1);
  });
});
