// CR-190 · lát cr190-msg-chat-ui · luật thuần khung chat: màn «Gửi lời chào đầu tiên», nhãn ngày dính, số trên nút «↓ n tin mới».
import { describe, expect, it } from "bun:test";
import type { Message } from "@ai/contracts/pack-contracts";
import { newBelowCount } from "./chat-view";
import { dayBarText, HELLO_KEYS, isFirstHello } from "./first-hello";

const ME = "00000000-0000-4000-8000-00000000000a";
const U1 = "00000000-0000-4000-8000-000000000001";
const msg = (seq: number, from: string, deleted = false): Message =>
  ({ seq, sender_id: from, at: "t", body: "x", deleted, client_id: `c${seq}`, files: [] }) as never;

describe("FirstHello", () => {
  it("chỉ hiện khi đã tải xong và chưa có tin nào, kể cả tin đang gửi", () => {
    expect(isFirstHello(true, 0, 0)).toBe(true);
    expect(isFirstHello(false, 0, 0)).toBe(false);
    expect(isFirstHello(true, 1, 0)).toBe(false);
    expect(isFirstHello(true, 0, 1)).toBe(false);
  });
  it("có đúng 3 câu chào gợi ý, khoá khác nhau", () => {
    expect(HELLO_KEYS).toHaveLength(3);
    expect(new Set(HELLO_KEYS).size).toBe(3);
  });
});

describe("nhãn ngày dính", () => {
  const words = { today: "Hôm nay", yesterday: "Hôm qua" };
  const now = new Date("2026-11-19T12:00:00Z");
  it("hôm nay / hôm qua / ngày đầy đủ", () => {
    expect(dayBarText("2026-11-19T12:00:00Z", words, now)).toBe("Hôm nay");
    expect(dayBarText("2026-11-18T12:00:00Z", words, now)).toBe("Hôm qua");
    expect(dayBarText("2026-11-10T12:00:00Z", words, now)).toMatch(/10/);
  });
});

describe("nút «↓ n tin mới»", () => {
  it("đếm tin người khác sau mốc đã thấy và bỏ tin mình và tin thu hồi", () => {
    const items = [msg(1, U1), msg(2, ME), msg(3, U1), msg(4, U1, true), msg(5, U1)];
    expect(newBelowCount(items, 1, ME)).toBe(2);
    expect(newBelowCount(items, 5, ME)).toBe(0);
  });
});
