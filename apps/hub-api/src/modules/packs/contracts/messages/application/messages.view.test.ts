// CR-132 M3 · HD-MSG-01..12 · luật thuần dựng DTO tin nhắn: con trỏ phân trang, xem trước, tóm tắt hội thoại, tin đã thu hồi.
import { describe, expect, it } from "bun:test";
import {
  ConversationDetailSchema,
  ConversationSummarySchema,
  MessageSchema,
} from "@ai/contracts/pack-contracts";
import type { RawConversation } from "./messages.ports";
import {
  decodeCursor,
  detailOf,
  encodeCursor,
  messageOf,
  partnerDetailOf,
  personIdsOf,
  previewOf,
  summaryOf,
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
  partner: null,
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

  it("chi tiết đúng contract: peer + tên, kẹp chưa đọc 100 («99+»), xem trước một dòng", () => {
    const people = new Map([
      [A, { name: "An", active: true }],
      [B, { name: "Bình", active: false }],
    ]);
    const d = detailOf(raw(), people);
    expect(ConversationDetailSchema.safeParse(d).success).toBe(true);
    expect(d.peer).toEqual({ id: B, name: "Bình", active: false, job_title: null });
    expect(d.unread).toBe(100);
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

describe("CR-169 · cuộc partner (view)", () => {
  const partner = raw({
    kind: "partner",
    member_count: 2,
    unread: 3,
    members: null,
    last: {
      seq: 2,
      sender_id: B,
      sender_name: "Hà",
      preview: "Báo giá  đây",
      has_files: false,
      deleted: false,
      at: "2026-11-12T10:00:00.123456Z",
    },
    partner: {
      peer_name: "Hà",
      peer_title: "Kế toán trưởng",
      peer_active: true,
      company_id: B,
      company_name: "Preschool Việt",
      read_only: true,
      my_read_seq: 1,
      peer_read_seq: 2,
    },
  });
  it("tóm tắt: peer + chức vụ, công ty, read_only, người gửi lấy từ DB (không tra nội bộ)", () => {
    const s = summaryOf(partner, new Map());
    expect(ConversationSummarySchema.safeParse(s).success).toBe(true);
    expect(s.kind).toBe("partner");
    expect(s.peer).toEqual({ id: B, name: "Hà", active: true, job_title: "Kế toán trưởng" });
    expect(s.company).toEqual({ id: B, name: "Preschool Việt" });
    expect(s.read_only).toBe(true);
    expect(s.member_count).toBe(2);
    expect(s.last_message?.sender_name).toBe("Hà");
    expect(s.last_message?.preview).toBe("Báo giá đây");
  });
  it("direct/group: company null, read_only false; personIdsOf bỏ cuộc partner", () => {
    const s = summaryOf(raw(), new Map());
    expect(s.company).toBeNull();
    expect(s.read_only).toBe(false);
    expect(personIdsOf([partner])).toEqual([]);
  });
  it("chi tiết partner: đúng 2 thành viên, my_role member, mốc đọc từ DB", () => {
    const d = partnerDetailOf(partner, { id: A, name: "An" });
    expect(ConversationDetailSchema.safeParse(d).success).toBe(true);
    expect(d.my_role).toBe("member");
    expect(d.members.map((m) => [m.user_id, m.last_read_seq])).toEqual([
      [A, 1],
      [B, 2],
    ]);
  });
  it("CR-190 · số chưa đọc hiển thị = max(chưa đọc thật, cờ ? 1 : 0): cờ trên cuộc đã đọc hết hiện 1, cuộc có tin thật không cộng đôi", () => {
    const u = (unread: number, marked: boolean) =>
      summaryOf(raw({ unread, marked_unread: marked }), new Map()).unread;
    expect([u(0, true), u(0, false), u(5, true), u(5, false)]).toEqual([1, 0, 5, 5]);
    const pu = (unread: number, marked: boolean) =>
      summaryOf({ ...partner, unread, marked_unread: marked }, new Map()).unread;
    expect([pu(0, true), pu(3, true), pu(3, false)]).toEqual([1, 3, 3]);
  });
});
