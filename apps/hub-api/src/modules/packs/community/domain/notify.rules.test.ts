import { describe, expect, it } from "bun:test";
import {
  bellText,
  commentRecipients,
  digestDue,
  kindOfBell,
  newPostKind,
  priceChanged,
  titleQuote,
  wantsKind,
} from "./notify.rules";

const T = "7e5d0000-0000-4000-8000-000000000001";
const O2 = "7e5d0000-0000-4000-8000-000000000002";
type Role = "author" | "commenter" | "mentioned";
const cand = (userId: string, org: string | null, role: Role, sees = true) => ({
  userId,
  org,
  role,
  sees,
});
/** Bình luận do `actorOrg` viết trên bài của chủ quản (mặc định), không nhắc ai. */
const ctx = (more: Partial<Parameters<typeof commentRecipients>[1]> = {}) => ({
  actorOrg: T,
  postAuthorOrg: null,
  mentions: [] as string[],
  ...more,
});

describe("commentRecipients", () => {
  it("người đăng nhận comment, người từng bình luận nhận reply, không gửi cho chính người viết", () => {
    const r = commentRecipients(
      [cand("host1", null, "author"), cand("p1", T, "commenter"), cand("actor", T, "commenter")],
      ctx(),
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
      ctx(),
      "actor",
    );
    expect(r).toEqual([{ userId: "h", kind: "comment" }]);
  });
  it("đối tác không nhận khi hết thấy bài hoặc không thấy bình luận (đối tác khác viết)", () => {
    const r = commentRecipients(
      [
        cand("blind", T, "commenter", false),
        cand("other", O2, "commenter"),
        cand("host", null, "commenter"),
      ],
      ctx(),
      "actor",
    );
    expect(r).toEqual([{ userId: "host", kind: "reply" }]); // chủ quản (còn quyền) thấy mọi bình luận
  });
  it("CR-129: chủ quản trả lời ⇒ mọi người từng bình luận (đối tác) nhận reply, kể cả đối tác khác", () => {
    const r = commentRecipients(
      [cand("p1", T, "commenter"), cand("p2", O2, "commenter")],
      ctx({ actorOrg: null }),
      "host",
    );
    expect(r).toEqual([
      { userId: "p1", kind: "reply" },
      { userId: "p2", kind: "reply" },
    ]);
  });
  it("CR-129: người của công ty được nhắc nhận mention (thắng comment/reply); công ty không được nhắc không nhận", () => {
    const r = commentRecipients(
      [
        cand("a1", T, "mentioned"),
        cand("a1", T, "commenter"),
        cand("own", T, "author"),
        cand("b1", O2, "commenter"),
      ],
      ctx({ actorOrg: null, postAuthorOrg: T, mentions: [T] }),
      "host",
    );
    expect(r).toEqual([
      { userId: "a1", kind: "mention" },
      { userId: "own", kind: "comment" },
      { userId: "b1", kind: "reply" },
    ]);
  });
  it("CR-129: đối tác viết trên bài của chính công ty khác ⇒ chỉ chủ quản + chính công ty đăng bài nhận", () => {
    const r = commentRecipients(
      [cand("host", null, "author"), cand("o2", O2, "commenter"), cand("t1", T, "author")],
      ctx({ actorOrg: O2, postAuthorOrg: T }),
      "actor",
    );
    expect(r).toEqual([
      { userId: "host", kind: "comment" },
      { userId: "o2", kind: "reply" },
      { userId: "t1", kind: "comment" },
    ]);
  });
  it("review Thấp-10: chủ quản đã mất quyền gói (sees=false) không nhận", () => {
    const r = commentRecipients(
      [cand("lost", null, "author", false), cand("lost2", null, "commenter", false)],
      ctx(),
      "actor",
    );
    expect(r).toEqual([]);
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
  it("kind chuông ↔ 9 loại; kind lạ bị bỏ", () => {
    expect(kindOfBell("community.mention")).toBe("mention");
    expect(kindOfBell("community.reply")).toBe("reply");
    expect(kindOfBell("community.price_edited")).toBe("priceEdited");
    expect(kindOfBell("contract.esign")).toBeNull();
  });
});

describe("chữ chuông gọn (UAT)", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  it("bài không tiêu đề ⇒ không in «(không tiêu đề)», tên người không lặp", () => {
    const t = bellText("comment", { id, title: "  " }, { actor: "Cường", ref: "c1" });
    expect(t.title).toBe("Cường bình luận một bài đăng");
    expect(t.title).not.toContain("không tiêu đề");
    expect(t.body).toBe("");
    expect(bellText("mention", { id, title: "" }, { actor: "An", ref: "c" }).title).toBe(
      "An nhắc đến công ty bạn trong một bài đăng",
    );
  });
  it("trích tiêu đề tối đa 60 KÝ TỰ Unicode (không cắt đôi emoji)", () => {
    expect(titleQuote("😀".repeat(70))).toBe(`“${"😀".repeat(60)}”`);
    expect(titleQuote("  ngắn  ")).toBe("“ngắn”");
    expect(titleQuote("")).toBe("");
  });
});

describe("chữ + link", () => {
  const post = { id: "11111111-1111-4111-8111-111111111111", title: "Token USB" };
  it("bình luận mở đúng bài + bình luận (đường dẫn trong app); mention khoá trùng riêng", () => {
    const t = bellText("comment", post, { actor: "An", ref: "c1" });
    expect(t.link).toBe(`/community?post=${post.id}&comment=c1`);
    expect(t.body).toBe(""); // không lặp tên người gửi (đã có ở tiêu đề)
    expect(t.title).toBe("An bình luận bài: “Token USB”");
    const m = bellText("mention", post, { actor: "An", ref: "c1" });
    expect({ link: m.link, dedup: m.dedup }).toEqual({
      link: `/community?post=${post.id}&comment=c1`,
      dedup: "c:c1:mention",
    });
    expect(m.dedup).not.toBe(t.dedup);
  });
  it("sửa giá mở form Lưu báo giá; khoá trùng đổi theo giá mới", () => {
    expect(bellText("priceEdited", post, { actor: "A", ref: "12" }).link).toBe(
      `/community?post=${post.id}&quote=1`,
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
