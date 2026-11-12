// CR-132 · schema zod tin nhắn: biên vào (nhóm/1-1/gửi tin) + sự kiện realtime.
import { describe, expect, test } from "bun:test";
import {
  AddMembersRequestSchema,
  CreateConversationRequestSchema,
  MeStreamMsgEventSchema,
  MsgListQuerySchema,
  SendMessageRequestSchema,
} from "./messages";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ids = (n: number) => Array.from({ length: n }, (_, i) => U(i + 1));

describe("CreateConversationRequest", () => {
  test("1-1 cần user_id uuid; nhóm: tên trim 1..80, 1..49 người không trùng", () => {
    const direct = (user_id: string) =>
      CreateConversationRequestSchema.safeParse({ kind: "direct", user_id }).success;
    expect(direct(U(1))).toBe(true);
    expect(direct("x")).toBe(false);
    const ok = CreateConversationRequestSchema.safeParse({
      kind: "group",
      title: "  Mua hàng  ",
      member_ids: [U(1)],
    });
    expect(ok.success && ok.data.kind === "group" && ok.data.title).toBe("Mua hàng");
    const grp = (title: string, member_ids: string[]) =>
      CreateConversationRequestSchema.safeParse({ kind: "group", title, member_ids }).success;
    expect(grp("   ", [U(1)])).toBe(false);
    expect(grp("a".repeat(81), [U(1)])).toBe(false);
    expect(grp("ok", [])).toBe(false);
    expect(grp("ok", [U(1), U(1)])).toBe(false);
    expect(grp("ok", ids(49))).toBe(true);
    expect(grp("ok", ids(50))).toBe(false);
  });
});

describe("SendMessageRequest · AddMembers · MsgListQuery", () => {
  const send = (body: string, file_ids?: string[]) =>
    SendMessageRequestSchema.safeParse({ client_id: U(1), body, file_ids }).success;
  test("gửi tin: body trim ≤ 4000, ≤ 10 tệp, mặc định file_ids = []", () => {
    expect(SendMessageRequestSchema.parse({ client_id: U(1), body: "  chào  " })).toEqual({
      client_id: U(1),
      body: "chào",
      file_ids: [],
    });
    expect(send("")).toBe(true); // rỗng ⇒ use case kiểm cùng số tệp (400 MSG_EMPTY)
    expect(send("a".repeat(4001))).toBe(false);
    expect(send("", ids(10))).toBe(true);
    expect(send("", ids(11))).toBe(false);
    expect(send("", [U(1), U(1)])).toBe(false);
    expect(SendMessageRequestSchema.safeParse({ client_id: "x", body: "a" }).success).toBe(false);
  });
  test("thêm người 1..20; phân trang tin mặc định 50, tối đa 100", () => {
    expect(AddMembersRequestSchema.safeParse({ user_ids: [] }).success).toBe(false);
    expect(AddMembersRequestSchema.safeParse({ user_ids: ids(20) }).success).toBe(true);
    expect(AddMembersRequestSchema.safeParse({ user_ids: ids(21) }).success).toBe(false);
    expect(MsgListQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(MsgListQuerySchema.parse({ before_seq: "9", limit: "100" })).toEqual({
      before_seq: 9,
      limit: 100,
    });
    expect(MsgListQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(MsgListQuerySchema.safeParse({ before_seq: "0" }).success).toBe(false);
  });
});

describe("MeStreamMsgEvent", () => {
  const ev = (event: string, data: unknown) =>
    MeStreamMsgEventSchema.safeParse({ event, data }).success;
  const message = {
    id: U(9),
    seq: 1,
    conversation_id: U(2),
    sender_id: U(3),
    client_id: U(4),
    body: "hi",
    files: [],
    at: "2026-11-12T01:00:00.000Z",
    deleted: false,
  };
  test("nhận 4 sự kiện, chặn trường lạ (strict)", () => {
    expect(ev("msg.new", { conversation_id: U(2), message })).toBe(true);
    expect(ev("msg.deleted", { conversation_id: U(2), seq: 3 })).toBe(true);
    expect(ev("msg.read", { conversation_id: U(2), user_id: U(3), seq: 0 })).toBe(true);
    expect(ev("msg.conversation", { conversation_id: U(2), change: "removed" })).toBe(true);
    expect(ev("msg.conversation", { conversation_id: U(2), change: "x" })).toBe(false);
    expect(ev("msg.new", { conversation_id: U(2), message, unread_total: 1 })).toBe(false);
  });
});
