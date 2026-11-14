// CR-161 · unit luật thuần kết nối (spec §2 R3, R7–R9).
import { describe, expect, test } from "bun:test";
import {
  canSendChat,
  ccDedupKey,
  connectStatusOf,
  inviteOutcome,
  type LinkRow,
  pairOf,
  validateChatMessage,
} from "./connect.rules";

const T = "2026-11-15T00:00:00.000Z";
const row = (o: Partial<LinkRow> = {}): LinkRow => ({
  requested_at: T,
  accepted_at: null,
  blocked_at: null,
  connect_requested_at: null,
  ...o,
});
const ok = row({ accepted_at: T });

describe("connectStatusOf (R7)", () => {
  test("hai chiều accepted, không chặn ⇒ connected", () => {
    expect(connectStatusOf({ out: ok, in: ok })).toBe("connected");
  });
  test("một chiều accepted ⇒ none (đường HĐ cũ không phải kết nối)", () => {
    expect(connectStatusOf({ out: ok, in: null })).toBe("none");
    expect(connectStatusOf({ out: ok, in: row() })).toBe("none");
  });
  test("một chiều bị chặn ⇒ không connected", () => {
    expect(connectStatusOf({ out: ok, in: row({ accepted_at: T, blocked_at: T }) })).not.toBe(
      "connected",
    );
  });
  test("pending_out / pending_in", () => {
    expect(connectStatusOf({ out: row({ connect_requested_at: T }), in: null })).toBe(
      "pending_out",
    );
    expect(connectStatusOf({ out: null, in: row({ connect_requested_at: T }) })).toBe("pending_in");
  });
  test("pending_out thắng pending_in khi mời chéo", () => {
    const r = row({ connect_requested_at: T });
    expect(connectStatusOf({ out: r, in: r })).toBe("pending_out");
  });
  test("declined cần blocked_at và requested_at; chặn trước không lộ", () => {
    expect(connectStatusOf({ out: row({ blocked_at: T }), in: null })).toBe("declined");
    expect(connectStatusOf({ out: row({ blocked_at: T, requested_at: null }), in: null })).toBe(
      "none",
    );
  });
  test("không có dòng ⇒ none", () => {
    expect(connectStatusOf({ out: null, in: null })).toBe("none");
  });
});

describe("inviteOutcome (R3)", () => {
  test("chưa bật Danh bạ ⇒ not_listed (trước mọi nhánh)", () => {
    expect(inviteOutcome({ out: ok, in: ok }, false)).toBe("not_listed");
  });
  test("đã connected ⇒ connected", () => {
    expect(inviteOutcome({ out: ok, in: ok }, true)).toBe("connected");
  });
  test("A→B bị chặn ⇒ declined", () => {
    expect(inviteOutcome({ out: row({ blocked_at: T }), in: null }, true)).toBe("declined");
  });
  test("đã mời chờ ⇒ pending_out (idempotent)", () => {
    expect(inviteOutcome({ out: row({ connect_requested_at: T }), in: null }, true)).toBe(
      "pending_out",
    );
  });
  test("có lời mời ngược chờ ⇒ accept_reverse", () => {
    expect(inviteOutcome({ out: null, in: row({ connect_requested_at: T }) }, true)).toBe(
      "accept_reverse",
    );
  });
  test("còn lại ⇒ invite (kể cả có dòng HĐ cũ một chiều)", () => {
    expect(inviteOutcome({ out: null, in: null }, true)).toBe("invite");
    expect(inviteOutcome({ out: ok, in: null }, true)).toBe("invite");
  });
});

describe("canSendChat (R8)", () => {
  test("chỉ connected", () => {
    expect(canSendChat("connected")).toBe(true);
    for (const s of ["pending_out", "pending_in", "declined", "none"] as const) {
      expect(canSendChat(s)).toBe(false);
    }
  });
});

describe("validateChatMessage (R8)", () => {
  test("hợp lệ", () => {
    expect(validateChatMessage("xin chào", 0)).toBeNull();
    expect(validateChatMessage("", 1)).toBeNull();
    expect(validateChatMessage("   ", 2)).toBeNull();
    expect(validateChatMessage("a".repeat(4000), 10)).toBeNull();
  });
  test("rỗng không tệp ⇒ MSG_EMPTY", () => {
    expect(validateChatMessage("", 0)).toBe("MSG_EMPTY");
    expect(validateChatMessage("  \n ", 0)).toBe("MSG_EMPTY");
  });
  test("quá dài / quá nhiều tệp", () => {
    expect(validateChatMessage("a".repeat(4001), 0)).toBe("MSG_TOO_LONG");
    expect(validateChatMessage("x", 11)).toBe("MSG_TOO_MANY_FILES");
  });
});

describe("ccDedupKey · pairOf (R8, R9)", () => {
  test("khoá chuông theo luồng và mốc đã đọc", () => {
    expect(ccDedupKey("t1", 7)).toBe("cc.msg:t1:7");
    expect(ccDedupKey("t1", 8)).not.toBe(ccDedupKey("t1", 7));
  });
  test("pairOf không phụ thuộc thứ tự, chuẩn hoá chữ thường", () => {
    const a = "AAAAAAAA-0000-4000-8000-000000000001";
    const b = "bbbbbbbb-0000-4000-8000-000000000002";
    expect(pairOf(a, b)).toEqual({ lo: a.toLowerCase(), hi: b });
    expect(pairOf(b, a)).toEqual(pairOf(a, b));
  });
});
