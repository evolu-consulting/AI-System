// CR-132 M3 · HD-MSG-01..12 · luật thuần dựng DTO tin nhắn: con trỏ phân trang, xem trước, tóm tắt hội thoại, tin đã thu hồi.
import { describe, expect, it } from "bun:test";
import { ConversationDetailSchema, MessageSchema } from "@ai/contracts/pack-contracts";
import type { RawConversation } from "./messages.ports";
import {
  decodeCursor,
  detailOf,
  encodeCursor,
  messageOf,
  personIdsOf,
  previewOf,
} from "./messages.view";

const A = "a0000000-0000-4000-8000-000000000001";
const B = "b0000000-0000-4000-8000-000000000002";
const C = "c0000000-0000-4000-8000-000000000003";

const raw = (o: Partial<RawConversation> = {}): RawConversation => ({
  id: C,
  kind: "direct",
  title: null,
  last_at: "2026-11-12T10:00:00.123456Z",
  member_count: 2,
  peer_id: B,
  unread: 250,
  last: {
    seq: 3,
    sender_id: B,
    preview: "xin   chào\nbạn",
    has_files: true,
    deleted: false,
    at: "2026-11-12T10:00:00.123456Z",
  },
  my_role: "member",
  members: [
    { user_id: A, role: "member", joined_at: "2026-11-12T09:00:00Z", last_read_seq: 1 },
    { user_id: B, role: "member", joined_at: "2026-11-12T09:00:00Z", last_read_seq: 3 },
  ],
  ...o,
});

describe("messages.view · con trỏ danh sách hội thoại", () => {
  it("encode → decode giữ nguyên; rác / sai dạng ⇒ null", () => {
    const c = { at: "2026-11-12T10:00:00.123456Z", id: C };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(decodeCursor("không-phải-base64")).toBeNull();
    expect(decodeCursor(Buffer.from(JSON.stringify(["x", C])).toString("base64url"))).toBeNull();
    expect(
      decodeCursor(
        Buffer.from(JSON.stringify(["2026-11-12T10:00:00Z", "'; drop"])).toString("base64url"),
      ),
    ).toBeNull();
  });
});

describe("messages.view · previewOf / tóm tắt / chi tiết / tin", () => {
  it("xem trước: gọn khoảng trắng, tối đa 120 ký tự", () => {
    expect(previewOf("xin   chào\n  bạn ")).toBe("xin chào bạn");
    expect(Array.from(previewOf("𝒳".repeat(300)))).toHaveLength(120);
  });

  it("chi tiết đúng contract: peer + tên, kẹp chưa đọc 99, xem trước một dòng", () => {
    const people = new Map([
      [A, { name: "An", active: true }],
      [B, { name: "Bình", active: false }],
    ]);
    const d = detailOf(raw(), people);
    expect(ConversationDetailSchema.safeParse(d).success).toBe(true);
    expect(d.peer).toEqual({ id: B, name: "Bình", active: false });
    expect(d.unread).toBe(99);
    expect(d.last_message?.preview).toBe("xin chào bạn");
    expect(d.last_message?.sender_name).toBe("Bình");
    expect(d.last_at).toBe("2026-11-12T10:00:00.123Z");
  });

  it("nhóm không có peer; tin cuối đã thu hồi ⇒ xem trước rỗng, không có tệp", () => {
    const g = detailOf(
      raw({
        kind: "group",
        title: "Mua hàng",
        peer_id: null,
        last: { ...(raw().last as NonNullable<RawConversation["last"]>), deleted: true },
      }),
      new Map(),
    );
    expect(g.peer).toBeNull();
    expect(g.last_message).toMatchObject({ preview: "", has_files: false, deleted: true });
  });

  it("tin đã thu hồi ⇒ body rỗng, files rỗng; id người cần tra tên gom đủ, không trùng", () => {
    const m = messageOf(
      {
        seq: 2,
        id: C,
        sender_id: A,
        client_id: B,
        body: "x",
        at: "2026-11-12T10:00:00Z",
        deleted: true,
        files: [{ id: C, name: "a.pdf", mime: "application/pdf", size: 1 }],
      },
      C,
    );
    expect(MessageSchema.safeParse(m).success).toBe(true);
    expect(m).toMatchObject({ body: "", files: [], deleted: true });
    expect(personIdsOf([raw()]).sort()).toEqual([A, B]);
  });
});
