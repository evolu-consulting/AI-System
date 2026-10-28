import { describe, expect, it } from "bun:test";
import {
  bellText,
  bellView,
  commentRecipients,
  digestDue,
  kindOfBell,
  newPostKind,
  priceChanged,
  wantsKind,
} from "./notify.rules";

const T = "7e5d0000-0000-4000-8000-000000000001";
const O2 = "7e5d0000-0000-4000-8000-000000000002";
const cand = (userId: string, org: string | null, role: "author" | "commenter", sees = true) => ({
  userId,
  org,
  role,
  sees,
});

describe("commentRecipients", () => {
  it("người đăng nhận comment, người từng bình luận nhận reply, không gửi cho chính người viết", () => {
    const r = commentRecipients(
      [cand("host1", null, "author"), cand("p1", T, "commenter"), cand("actor", T, "commenter")],
      T,
      "actor",
    );
    expect(r).toEqual([
      { userId: "host1", kind: "comment" },
      { userId: "p1", kind: "reply" },
    ]);
  });
  it("người vừa là người đăng vừa từng bình luận chỉ nhận một thông báo: comment", () => {
    const r = commentRecipients(
      [cand("h", null, "commenter"), cand("h", null, "author")],
      T,
      "actor",
    );
    expect(r).toEqual([{ userId: "h", kind: "comment" }]);
  });
  it("đối tác không nhận khi hết thấy bài hoặc luồng không phải của công ty mình", () => {
    const r = commentRecipients(
      [
        cand("blind", T, "commenter", false),
        cand("other", O2, "commenter"),
        cand("host", null, "commenter", false),
      ],
      T,
      "actor",
    );
    expect(r).toEqual([{ userId: "host", kind: "reply" }]); // chủ quản luôn thấy
  });
});

describe("loại thông báo", () => {
  it("chỉ bài Cần bán/Cần mua của đối tác mới báo chủ quản", () => {
    expect(newPostKind({ type: "sell", authorOrg: T })).toBe("newSell");
    expect(newPostKind({ type: "buy", authorOrg: T })).toBe("newBuy");
    expect(newPostKind({ type: "sell", authorOrg: null })).toBeNull();
    expect(newPostKind({ type: "note", authorOrg: T })).toBeNull();
  });
  it("mặc định Bật, riêng digest Tắt; ghi đè boolean thắng, rác bị bỏ qua", () => {
    expect(wantsKind({}, "comment")).toBe(true);
    expect(wantsKind(null, "digest")).toBe(false);
    expect(wantsKind({ comment: false, digest: true }, "comment")).toBe(false);
    expect(wantsKind({ digest: true }, "digest")).toBe(true);
    expect(wantsKind({ comment: "no" }, "comment")).toBe(true);
  });
  it("giá sửa: bỏ qua khác biệt khoảng trắng", () => {
    expect(priceChanged("10.000  đ", "10.000 đ")).toBe(false);
    expect(priceChanged(null, "")).toBe(false);
    expect(priceChanged("10", "12")).toBe(true);
  });
  it("kind chuông ↔ 8 loại; kind lạ bị bỏ", () => {
    expect(kindOfBell("community.reply")).toBe("reply");
    expect(kindOfBell("community.price_edited")).toBe("priceEdited");
    expect(kindOfBell("contract.esign")).toBeNull();
  });
});

describe("chữ + link", () => {
  const post = { id: "11111111-1111-4111-8111-111111111111", title: "Token USB" };
  it("bình luận mở đúng bài + luồng; bellView đọc ngược lại", () => {
    const t = bellText("comment", post, { actor: "An", threadOrg: T, ref: "c1" });
    expect(t.link).toBe(`/posts/${post.id}/threads/${T}`);
    const v = bellView({
      id: "n",
      kind: "community.comment",
      title: t.title,
      body: t.body,
      link: t.link,
      created_at: "2026-01-01T00:00:00.000Z",
      read: false,
    });
    expect(v).toMatchObject({
      kind: "comment",
      actorName: "An",
      postId: post.id,
      orgId: T,
      unread: true,
    });
  });
  it("sửa giá mở form Lưu báo giá; khoá trùng đổi theo giá mới", () => {
    expect(bellText("priceEdited", post, { actor: "A", ref: "12" }).link).toBe(
      `/posts/${post.id}?quote=1`,
    );
    expect(bellText("priceEdited", post, { actor: "A", ref: "12" }).dedup).not.toBe(
      bellText("priceEdited", post, { actor: "A", ref: "13" }).dedup,
    );
  });
});

describe("digestDue", () => {
  it("8:00 giờ Hà Nội = 01:00 UTC", () => {
    expect(digestDue(new Date("2026-03-01T00:59:00Z"), "Asia/Ho_Chi_Minh")).toEqual({
      due: false,
      day: "2026-03-01",
    });
    expect(digestDue(new Date("2026-03-01T01:00:00Z"), "Asia/Ho_Chi_Minh")).toEqual({
      due: true,
      day: "2026-03-01",
    });
  });
});
