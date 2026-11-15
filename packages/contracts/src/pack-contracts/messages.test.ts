// CR-132 · schema zod tin nhắn: biên vào (nhóm/1-1/gửi tin) + sự kiện realtime.
import { describe, expect, test } from "bun:test";
import {
  AddMembersRequestSchema,
  ConvKindSchema,
  CreateConversationRequestSchema,
  MeStreamMsgEventSchema,
  MSG_ERRORS,
  MsgCompaniesQuerySchema,
  MsgCompanyPageSchema,
  MsgConversationsQuerySchema,
  MsgListQuerySchema,
  MsgPeopleQuerySchema,
  MsgPersonSchema,
  parseMeStreamMsgEvent,
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
  test("thêm người 1..20; phân trang tin mặc định 30 (CR-148), tối đa 100", () => {
    expect(AddMembersRequestSchema.safeParse({ user_ids: [] }).success).toBe(false);
    expect(AddMembersRequestSchema.safeParse({ user_ids: ids(20) }).success).toBe(true);
    expect(AddMembersRequestSchema.safeParse({ user_ids: ids(21) }).success).toBe(false);
    expect(MsgListQuerySchema.parse({})).toEqual({ limit: 30 });
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

describe("parseMeStreamMsgEvent", () => {
  test("chuỗi SSE hoặc object đúng ⇒ sự kiện; JSON hỏng / event lạ / khoá thừa ⇒ null", () => {
    const data = { conversation_id: U(2), change: "added" };
    expect(parseMeStreamMsgEvent("msg.conversation", JSON.stringify(data))?.event).toBe(
      "msg.conversation",
    );
    expect(parseMeStreamMsgEvent("msg.conversation", data)?.event).toBe("msg.conversation");
    expect(parseMeStreamMsgEvent("msg.conversation", "{hỏng")).toBeNull();
    expect(parseMeStreamMsgEvent("process.updated", data)).toBeNull();
    expect(parseMeStreamMsgEvent("msg.conversation", { ...data, x: 1 })).toBeNull();
  });
});

describe("CR-169 · partner", () => {
  const T = U(9);
  test("tạo cuộc partner: strict, cần tenant_id + user_id uuid", () => {
    const p = (o: object) =>
      CreateConversationRequestSchema.safeParse({ kind: "partner", ...o }).success;
    expect(p({ tenant_id: T, user_id: U(1) })).toBe(true);
    expect(p({ user_id: U(1) })).toBe(false);
    expect(p({ tenant_id: "x", user_id: U(1) })).toBe(false);
    expect(p({ tenant_id: T, user_id: U(1), extra: 1 })).toBe(false);
  });
  test("company ≤ 40 ký tự ở danh sách cuộc và danh bạ", () => {
    expect(MsgConversationsQuerySchema.safeParse({ company: "own" }).success).toBe(true);
    expect(MsgConversationsQuerySchema.safeParse({ company: "a".repeat(41) }).success).toBe(false);
    expect(MsgPeopleQuerySchema.safeParse({ company: T }).success).toBe(true);
    expect(MsgPeopleQuerySchema.safeParse({ company: "a".repeat(41) }).success).toBe(false);
  });
  test("danh sách công ty: limit 1..50 mặc định 30; strict", () => {
    expect(MsgCompaniesQuerySchema.parse({}).limit).toBe(30);
    expect(MsgCompaniesQuerySchema.safeParse({ limit: "51" }).success).toBe(false);
    expect(MsgCompaniesQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(MsgCompaniesQuerySchema.safeParse({ x: 1 }).success).toBe(false);
    const page = { items: [{ id: T, name: "A" }], next_cursor: null };
    expect(MsgCompanyPageSchema.safeParse(page).success).toBe(true);
  });
  test("người danh bạ cần job_title (null được) + company; MSG_NOT_CONNECTED = 409", () => {
    const base = { id: U(1), name: "Hà", department: null };
    const co = { id: T, name: "P" };
    expect(MsgPersonSchema.safeParse({ ...base, job_title: null, company: co }).success).toBe(true);
    const long = { ...base, job_title: "x".repeat(81), company: co };
    expect(MsgPersonSchema.safeParse(long).success).toBe(false);
    expect(MsgPersonSchema.safeParse({ ...base, job_title: null }).success).toBe(false);
    expect(MSG_ERRORS.MSG_NOT_CONNECTED).toBe(409);
    expect(ConvKindSchema.safeParse("partner").success).toBe(true);
  });
});
