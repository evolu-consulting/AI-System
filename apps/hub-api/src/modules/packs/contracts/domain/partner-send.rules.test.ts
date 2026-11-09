// CR-124 · q3 · luật thuần gửi đối tác: kênh tự chọn (FR-15), mức cuối = max(gợi ý, luật bên nhận) (FR-08), gửi lại sau Trả lại (FR-17), bản chia sẻ.
import { describe, expect, it } from "bun:test";
import {
  buildPayload,
  finalImportance,
  importanceByValue,
  planChannel,
  prevMailboxOf,
  replyDaysOf,
  sharedValueOf,
  toKeyOf,
} from "./partner-send.rules";

const route = (link: string) => ({ toTenant: "t-b", name: "Công ty B", verified: true, link });

describe("planChannel (FLOW4-FR-15)", () => {
  it("đã nối ⇒ nền tảng", () => {
    expect(planChannel(route("accepted"), "x@y.vn", null)).toMatchObject({
      channel: "platform",
      toTenant: "t-b",
    });
  });
  it("nền tảng ⇒ giữ email người nhận đã chọn (để báo vào app), không email ⇒ toEmail null, khoá gồm cả email", () => {
    const withMail = planChannel(route("accepted"), "Chon@B.vn", null);
    expect(withMail).toMatchObject({ channel: "platform", toEmail: "Chon@B.vn", held: false });
    expect(toKeyOf(withMail)).toBe("t:t-b|e:chon@b.vn");
    const noMail = planChannel(route("accepted"), null, null);
    expect(noMail).toMatchObject({ channel: "platform", toEmail: null });
    expect(toKeyOf(noMail)).toBe("t:t-b");
  });
  it("kênh email giữ nguyên: toEmail = email, khoá e:", () => {
    const p = planChannel(null, "x@y.vn", null);
    expect(p).toMatchObject({ channel: "email", toEmail: "x@y.vn" });
    expect(toKeyOf(p)).toBe("e:x@y.vn");
  });
  it("chưa nối / bị chặn / không trên nền tảng + có email ⇒ email, ghi lý do", () => {
    // chưa nối ⇒ vẫn nền tảng nhưng GIỮ tới khi B chấp nhận (q4)
    expect(planChannel(route("pending"), "x@y.vn", null)).toMatchObject({
      channel: "platform",
      held: true,
    });
    expect(planChannel(route("blocked"), "x@y.vn", null)).toMatchObject({
      channel: "email",
      why: "link_blocked",
    });
    expect(planChannel(null, "x@y.vn", "Đối tác C")).toMatchObject({
      channel: "email",
      why: "not_on_platform",
      toName: "Đối tác C",
    });
  });
  it("không email ⇒ ghi nhận thủ công", () => {
    expect(planChannel(null, null, null)).toMatchObject({
      channel: "manual",
      why: "not_on_platform",
    });
  });
});

describe("mức quan trọng (FLOW4-FR-08)", () => {
  it("theo giá trị: 600 triệu ⇒ quan trọng; 2,1 tỷ ⇒ rất quan trọng; không có ⇒ thường", () => {
    expect(importanceByValue(600_000_000)).toBe("important");
    expect(importanceByValue(2_100_000_000)).toBe("critical");
    expect(importanceByValue(null)).toBe("normal");
  });
  it("mức cuối = max(gợi ý A, luật B); gợi ý thường/auto/lạ không hạ mức luật", () => {
    expect(finalImportance("normal", "important")).toBe("important");
    expect(finalImportance("auto", "important")).toBe("important");
    expect(finalImportance("critical", "normal")).toBe("critical");
    expect(finalImportance("hack", "normal")).toBe("normal");
  });
});

describe("gửi lại sau Trả lại (FLOW4-FR-17)", () => {
  const key = toKeyOf(planChannel(route("accepted"), null, null));
  it("trả lại + cùng bên nhận ⇒ prev_id; khác bên / chưa trả lại ⇒ null", () => {
    expect(prevMailboxOf({ mailboxId: "m1", status: "returned", toKey: key }, key)).toBe("m1");
    expect(
      prevMailboxOf({ mailboxId: "m1", status: "returned", toKey: "e:z@y.vn" }, key),
    ).toBeNull();
    expect(prevMailboxOf({ mailboxId: "m1", status: "declined", toKey: key }, key)).toBeNull();
    expect(prevMailboxOf(null, key)).toBeNull();
  });
});

describe("bản chia sẻ", () => {
  it("chỉ trường A chọn, bỏ trường rỗng; không lộ trường khác của HĐ", () => {
    const p = buildPayload({
      title: "HĐ mua bán",
      message: "Xin xác nhận",
      hint: "important",
      sendFields: ["total_value", "end_date"],
      fields: {
        total_value: { value: 600 },
        end_date: { value: null },
        buyer_name: { value: "Bí mật" },
      },
    });
    expect(p).toEqual({
      title: "HĐ mua bán",
      message: "Xin xác nhận",
      importance_hint: "important",
      fields: { total_value: 600 },
    });
    expect(sharedValueOf({ total_value: "600000000" })).toBe(600_000_000);
    expect(sharedValueOf({})).toBeNull();
  });
  it("hạn trả lời: 1..30 ngày, ngoài khoảng ⇒ mặc định 7", () => {
    expect([replyDaysOf(3), replyDaysOf(31), replyDaysOf("x"), replyDaysOf(undefined)]).toEqual([
      3, 7, 7, 7,
    ]);
  });
});
