// CR-102 · com-c3 · unit luật người xem (D2) + việc trên bài + cột raw/masked (D4).
import { describe, expect, it } from "bun:test";
import {
  type Audience,
  audienceIncludes,
  defaultAudience,
  effectiveStatus,
  partnerMayPost,
  postActions,
} from "./audience.rules";
import { storeComment, storeContent } from "./content.rules";

const S1 = { org: "s1", labels: ["supplier"] as const, cats: ["dong-goi"] };
const S2 = { org: "s2", labels: ["supplier"] as const, cats: ["chu-ky-so"] };
const B1 = { org: "b1", labels: ["buyer"] as const, cats: ["dong-goi"] };
const B2 = { org: "b2", labels: ["buyer"] as const, cats: ["chu-ky-so"] };
const X = { org: "x", labels: ["supplier", "buyer"] as const, cats: ["dong-goi"] };
const aud = (mode: Audience["mode"], more: Partial<Audience> = {}): Audience => ({
  mode,
  cats: [],
  companies: [],
  ...more,
});

describe("D2 audienceIncludes (trùng community.audience_ok)", () => {
  const pack = ["dong-goi"];
  it.each([
    ["all ⇒ mọi bạn bè", aud("all"), "sell", S1, true],
    ["buyers ⇒ S1 không (HT-04)", aud("buyers"), "note", S1, false],
    ["suppliers ⇒ B1 không (HT-05)", aud("suppliers"), "note", B1, false],
    ["suppliers ⇒ X có (HT-10)", aud("suppliers"), "note", X, true],
    ["buyers ⇒ X có (HT-11)", aud("buyers"), "note", X, true],
    ["cats bán đóng gói ⇒ B1 (HT-06)", aud("cats"), "sell", B1, true],
    ["cats bán đóng gói ⇒ B2 không (HT-07)", aud("cats"), "sell", B2, false],
    ["cats bán mặc định ⇒ S1 không (HT-13)", aud("cats"), "sell", S1, false],
    ["cats mua mặc định ⇒ B1 không (HT-14)", aud("cats"), "buy", B1, false],
    ["cats mua mặc định ⇒ S1 có", aud("cats"), "buy", S1, true],
    [
      "cats chọn tay chữ ký số ⇒ S2 (thông báo)",
      aud("cats", { cats: ["chu-ky-so"] }),
      "note",
      S2,
      true,
    ],
    [
      "companies {S2} ⇒ S1 không (HT-08)",
      aud("companies", { companies: ["s2"] }),
      "note",
      S1,
      false,
    ],
    ["companies {S2} ⇒ S2 (HT-09)", aud("companies", { companies: ["s2"] }), "note", S2, true],
  ] as const)("%s", (_n, a, type, v, want) => {
    expect(audienceIncludes(a, type, pack, v)).toBe(want);
  });
  it("mặc định theo loại", () => {
    expect([
      defaultAudience("sell").mode,
      defaultAudience("buy").mode,
      defaultAudience("note").mode,
    ]).toEqual(["cats", "cats", "all"]);
  });
});

describe("việc trên bài (server tính)", () => {
  const p = (authorOrg: string | null, type: "sell" | "buy" | "note" = "sell") => ({
    type,
    authorOrg,
    status: "active" as const,
    hidden: false,
  });
  it("HT-60/61/64: saveQuote chỉ chủ quản trên Cần bán của đối tác; đối tác không bao giờ có saveQuote/hide", () => {
    expect({
      hostOnS1Sell: postActions(p("s1"), { org: null }),
      hostOnB1Buy: postActions(p("b1", "buy"), { org: null }),
      hostOwn: postActions(p(null, "note"), { org: null }),
      s1Own: postActions(p("s1"), { org: "s1" }),
      s2OnHost: postActions(p(null), { org: "s2" }),
    }).toEqual({
      hostOnS1Sell: ["hide", "saveQuote"],
      hostOnB1Buy: ["hide"],
      hostOwn: ["edit", "archive", "delete"],
      s1Own: ["edit", "archive", "done", "delete"],
      s2OnHost: [],
    });
  });
  it("bài lưu trữ/hết hạn ⇒ bỏ lưu trữ; bị ẩn ⇒ bỏ ẩn", () => {
    expect(postActions({ ...p("s1"), status: "expired" }, { org: "s1" })).toEqual([
      "edit",
      "unarchive",
      "delete",
    ]);
    expect(postActions({ ...p("s1"), hidden: true }, { org: null })).toEqual([
      "unhide",
      "saveQuote",
    ]);
  });
  it("đối tác đăng theo nhãn; hết hạn tính theo đồng hồ", () => {
    expect([
      partnerMayPost("sell", ["supplier"]),
      partnerMayPost("buy", ["supplier"]),
      partnerMayPost("note", ["supplier", "buyer"]),
    ]).toEqual([true, false, false]);
    const now = new Date("2026-10-28T00:00:00Z");
    expect(effectiveStatus("active", new Date("2026-10-27T00:00:00Z"), now)).toBe("expired");
    expect(effectiveStatus("archived", new Date("2026-10-27T00:00:00Z"), now)).toBe("archived");
  });
});

describe("D4 raw + masked lúc ghi", () => {
  it("HT-51/53/54: đối tác: che SĐT/email + tên công ty khác, giữ tên chính mình; chủ quản (HT-55): không che", () => {
    const s = storeContent(
      {
        title: "Bán băng keo",
        body: "Gọi 0912 345 678, mail a@b.vn. Rẻ hơn Hãng NCCA. Cơ sở Tân Phát",
        fields: { price: null, qty: "Zalo 0987654321" },
      },
      ["Hãng NCCA"],
    );
    expect(s.body.masked).not.toContain("0912");
    expect(s.body.masked).not.toContain("a@b.vn");
    expect(s.body.masked).not.toContain("NCCA");
    expect(s.body.masked).toContain("Cơ sở Tân Phát");
    expect(s.fields.masked.qty).not.toContain("0987654321");
    expect(s.fields.raw.qty).toBe("Zalo 0987654321");
    expect(s.body.hits.map((h) => h.kind)).toEqual(["phone", "email", "company"]);
    expect(s.contactDetected).toBe(true);
    const host = storeComment("Gọi tôi 0912345678", null);
    expect(host).toEqual({ raw: "Gọi tôi 0912345678", masked: "Gọi tôi 0912345678", hits: [] });
  });
});
