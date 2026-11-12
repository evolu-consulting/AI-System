// CR-132 · sửa lỗi review cuối đợt (web tin nhắn): «đang xem» theo id, tên người gửi từ dữ liệu có sẵn, thu hồi tin chưa đọc, xem trước dùng chung.
import { describe, expect, it } from "bun:test";
import {
  type ConversationSummary,
  MSG_PREVIEW_MAX,
  MSG_UNREAD_CONV_CAP,
  messagePreview,
} from "@ai/contracts/pack-contracts";
import { applyNewToList, type ListPages, senderNameFrom, unreadOf } from "./conversations";
import { createViewing } from "./viewing";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U = id(900);
const group = (o: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id: id(1),
  kind: "group",
  title: "Kế toán",
  peer: null,
  member_count: 3,
  last_message: null,
  unread: 0,
  last_at: "2026-11-05T10:00:00.000Z",
  ...o,
});
const list = (...c: ConversationSummary[]): ListPages => ({
  pages: [{ items: c, next_cursor: null }],
});

describe("đang xem theo id (mục 6)", () => {
  it("dọn hội thoại cũ sau khi hội thoại mới đã đặt thì KHÔNG làm mất «đang xem» hội thoại mới", () => {
    const v = createViewing();
    v.enter("A");
    v.enter("B"); // mở B trước khi cleanup của A chạy
    v.leave("A");
    expect(v.current()).toBe("B");
    v.leave("B");
    expect(v.current()).toBeNull();
  });
});

describe("tên người gửi từ dữ liệu sẵn có (mục 9)", () => {
  it("1-1 ⇒ tên người kia; nhóm ⇒ thành viên trong chi tiết đã tải; rồi tin cuối cùng người gửi; không biết ⇒ rỗng", () => {
    const direct = group({ id: id(2), kind: "direct", peer: { id: U, name: "Lan", active: true } });
    const withLast = group({
      last_message: {
        seq: 3,
        sender_id: U,
        sender_name: "Hoa",
        preview: "x",
        has_files: false,
        deleted: false,
        at: "2026-11-05T10:00:00.000Z",
      },
    });
    const l = list(direct, withLast);
    expect(senderNameFrom(l, undefined, id(2), U)).toBe("Lan");
    expect(senderNameFrom(l, [{ user_id: U, name: "Mai" }], id(1), U)).toBe("Mai");
    expect(senderNameFrom(l, undefined, id(1), U)).toBe("Hoa");
    expect(senderNameFrom(l, undefined, id(1), id(901))).toBe("");
    expect(senderNameFrom(undefined, undefined, id(1), U)).toBe("");
  });
});

describe("thu hồi tin chưa đọc (mục 3) + trần đếm (mục 4)", () => {
  it("unreadOf: hội thoại có chưa đọc ⇒ >0 (cần tải lại danh sách khi tin bị thu hồi); không có ⇒ 0", () => {
    const l = list(group({ unread: 3 }), group({ id: id(2) }));
    expect(unreadOf(l, id(1))).toBe(3);
    expect(unreadOf(l, id(2))).toBe(0);
    expect(unreadOf(l, id(9))).toBe(0);
    expect(unreadOf(undefined, id(1))).toBe(0);
  });
  it("tin mới cộng chưa đọc tới trần 100 trên dây (hiện «99+»), không vượt", () => {
    const m = {
      id: id(50),
      seq: 5,
      conversation_id: id(1),
      sender_id: U,
      client_id: id(51),
      body: "hi",
      files: [],
      at: "2026-11-05T11:00:00.000Z",
      deleted: false,
    };
    const ctx = { myId: id(1000), viewing: false, senderName: "x" };
    const r99 = applyNewToList(list(group({ unread: 99 })), m, ctx);
    expect(r99.data.pages[0]?.items[0]?.unread).toBe(MSG_UNREAD_CONV_CAP);
    const r100 = applyNewToList(list(group({ unread: 100 })), m, ctx);
    expect(r100.data.pages[0]?.items[0]?.unread).toBe(MSG_UNREAD_CONV_CAP);
  });
});

describe("xem trước dùng chung (mục 7)", () => {
  it("gộp xuống dòng/khoảng trắng thành một dòng", () => {
    expect(messagePreview("  xin \n  chào\t bạn  ")).toBe("xin chào bạn");
  });
  it("cắt theo KÝ TỰ Unicode, không cắt đôi cặp thay thế (emoji)", () => {
    const body = "😀".repeat(MSG_PREVIEW_MAX + 10);
    const p = messagePreview(body);
    expect(Array.from(p).length).toBe(MSG_PREVIEW_MAX);
    expect(p).toBe("😀".repeat(MSG_PREVIEW_MAX));
    expect(messagePreview("a".repeat(MSG_PREVIEW_MAX))).toBe("a".repeat(MSG_PREVIEW_MAX));
  });
});
