// C5 · unit logic thuần: lọc bảng tin, audience, che liên hệ, form soạn, hiển thị.
import { describe, expect, test } from "bun:test";
import type { PartnerOrg, PostView } from "@ai/contracts/community";
import { audienceError, audienceSummary, previewRecipients, previewText } from "./audience";
import { canAddMedia, draftErrors, emptyDraft, toCreateInput } from "./compose";
import { applyFeedQuery, countTabs, fold, hasActiveFilter } from "./filters";
import { expiryNote, factRows, initials, timeAgo } from "./format";
import { applyMask, detectHits } from "./mask";
import { canViewPost, defaultAudience } from "./visibility";

const post = (o: Partial<PostView>): PostView => ({
  id: "x",
  type: "sell",
  authorOrgId: "host",
  authorOrgName: "H",
  authorName: "n",
  authorSide: "host",
  createdAt: new Date().toISOString(),
  edited: false,
  status: "active",
  title: "T",
  body: "B",
  fields: {},
  cats: [],
  media: [],
  commentCount: 0,
  actions: [],
  ...o,
});

describe("filters", () => {
  const all = [
    post({
      id: "1",
      type: "sell",
      cats: ["Đóng gói"],
      fields: { product: "Băng keo 5cm", area: "TP.HCM" },
    }),
    post({
      id: "2",
      type: "buy",
      cats: ["Chữ ký số"],
      fields: { product: "USB Token", area: "Hà Nội" },
    }),
    post({ id: "3", type: "note", status: "archived" }),
  ];
  test("tab + đếm", () => {
    expect(applyFeedQuery(all, { tab: "all" }).map((p) => p.id)).toEqual(["1", "2"]);
    expect(applyFeedQuery(all, { tab: "archived" }).map((p) => p.id)).toEqual(["3"]);
    expect(countTabs(all, { tab: "all" })).toEqual({
      all: 2,
      sell: 1,
      buy: 1,
      note: 0,
      archived: 1,
    });
  });
  test("tìm không dấu, chữ thường", () => {
    expect(fold("Băng KEO Đóng")).toBe("bang keo dong");
    expect(applyFeedQuery(all, { tab: "all", q: "bang keo" }).map((p) => p.id)).toEqual(["1"]);
  });
  test("nhóm hàng, khu vực, người đăng", () => {
    expect(applyFeedQuery(all, { tab: "all", cat: "Chữ ký số" }).map((p) => p.id)).toEqual(["2"]);
    expect(applyFeedQuery(all, { tab: "all", area: "TP.HCM" }).map((p) => p.id)).toEqual(["1"]);
    expect(applyFeedQuery(all, { tab: "all", authorOrgId: "zzz" })).toEqual([]);
    expect(hasActiveFilter({ tab: "all" })).toBe(false);
    expect(hasActiveFilter({ tab: "all", cat: "a" })).toBe(true);
  });
});

describe("audience", () => {
  const partners: PartnerOrg[] = [
    { id: "s1", name: "S1", labels: ["supplier"], cats: ["Đóng gói"] },
    { id: "b1", name: "B1", labels: ["buyer"], cats: ["Đóng gói"] },
    { id: "b2", name: "B2", labels: ["buyer"], cats: ["Chữ ký số"] },
    { id: "x", name: "X", labels: ["supplier", "buyer"], cats: ["Chữ ký số"] },
    { id: "gone", name: "Gone", labels: ["buyer"], cats: ["Đóng gói"], left: true },
  ];
  const ids = (
    a: Parameters<typeof previewRecipients>[0],
    t: "sell" | "buy" | "note",
    c: string[],
  ) => previewRecipients(a, t, c, partners).map((p) => p.id);
  test("preview theo chế độ (HT-04..HT-11)", () => {
    expect(ids({ mode: "all", cats: [], companies: [] }, "sell", [])).toEqual([
      "s1",
      "b1",
      "b2",
      "x",
    ]);
    expect(ids({ mode: "suppliers", cats: [], companies: [] }, "note", [])).toEqual(["s1", "x"]);
    expect(ids({ mode: "buyers", cats: [], companies: [] }, "note", [])).toEqual(["b1", "b2", "x"]);
    expect(ids({ mode: "cats", cats: ["Đóng gói"], companies: [] }, "sell", [])).toEqual(["b1"]);
    expect(ids({ mode: "companies", cats: [], companies: ["x"] }, "sell", [])).toEqual(["x"]);
  });
  test("mặc định theo loại (D2) dùng nhóm hàng của bài", () => {
    expect(defaultAudience("sell").mode).toBe("cats");
    expect(defaultAudience("note").mode).toBe("all");
    expect(ids(undefined, "sell", ["Đóng gói"])).toEqual(["b1"]); // Cần bán ⇒ người mua nhóm hàng
    expect(ids(undefined, "buy", ["Đóng gói"])).toEqual(["s1"]); // Cần mua ⇒ NCC nhóm hàng
  });
  test("văn bản + lỗi", () => {
    expect(audienceError({ mode: "companies", cats: [], companies: [] })).not.toBeNull();
    expect(audienceError({ mode: "cats", cats: [], companies: [] })).toBeNull();
    expect(previewText([])).toContain("Chưa có");
    expect(previewText(partners.slice(0, 4))).toContain("và 1 công ty khác");
    expect(audienceSummary({ mode: "suppliers", cats: [], companies: [] }, "note")).toBe(
      "Chỉ nhà cung cấp",
    );
  });
});

describe("visibility (hien-thi.md)", () => {
  const s1 = {
    userId: "s1",
    name: "a",
    role: "partner" as const,
    orgId: "s1",
    orgName: "S1",
    labels: ["supplier" as const],
    cats: ["Đóng gói"],
  };
  const host = { ...s1, role: "host_admin" as const, orgId: "host", labels: [] };
  const base = {
    type: "note" as const,
    authorOrgId: "host",
    authorSide: "host" as const,
    status: "active" as const,
    hidden: false,
    cats: [],
    audience: defaultAudience("note"),
  };
  test("host thấy hết; đối tác theo audience, lưu trữ/ẩn", () => {
    expect(canViewPost({ ...base, status: "archived" }, host)).toBe(true);
    expect(canViewPost(base, s1)).toBe(true); // HT-02
    expect(canViewPost({ ...base, status: "archived" }, s1)).toBe(false); // HT-15
    expect(canViewPost({ ...base, hidden: true }, s1)).toBe(false); // HT-16
    expect(
      canViewPost({ ...base, audience: { mode: "buyers", cats: [], companies: [] } }, s1),
    ).toBe(false); // HT-04
  });
  test("bài đối tác: chỉ chủ quản và chính họ (HT-20..23, HT-30)", () => {
    const own = {
      ...base,
      authorOrgId: "s1",
      authorSide: "partner" as const,
      type: "sell" as const,
    };
    expect(canViewPost(own, s1)).toBe(true);
    expect(canViewPost({ ...own, hidden: true }, s1)).toBe(true);
    expect(canViewPost({ ...own, authorOrgId: "s2" }, s1)).toBe(false);
    expect(canViewPost(own, host)).toBe(true);
  });
});

describe("mask (D4)", () => {
  const ctx = { ownOrgName: "Cơ sở Tân Phát", otherOrgNames: ["Cơ sở Tân Phát", "Hãng NCCA"] };
  test("che SĐT, link, email, MST, công ty khác; không che tên chính mình", () => {
    const t = "Gọi 0903 123 456 / a@b.vn / fb.com/x, MST 0312345678. Cơ sở Tân Phát và Hãng NCCA";
    const hits = detectHits(t, "body", ctx);
    expect(hits.map((h) => h.kind).sort()).toEqual(["company", "email", "link", "phone", "taxId"]);
    const m = applyMask(t, hits);
    expect(m).not.toMatch(/0903|a@b|fb\.com|0312345678|NCCA/);
    expect(m).toContain("Cơ sở Tân Phát");
  });
});

describe("compose + format", () => {
  test("trường bắt buộc theo loại", () => {
    expect(Object.keys(draftErrors(emptyDraft("sell")))).toEqual(["product", "qty"]);
    expect(Object.keys(draftErrors(emptyDraft("buy"))).sort()).toEqual([
      "area",
      "neededBy",
      "product",
      "qty",
    ]);
    expect(Object.keys(draftErrors(emptyDraft("note")))).toEqual(["body"]);
  });
  test("Cần bán không giá = liên hệ; đối tác không gửi audience", () => {
    const d = { ...emptyDraft("sell"), product: "A", qty: "1", audience: defaultAudience("sell") };
    const host = toCreateInput(d, true);
    expect(host.type === "sell" && host.fields.price).toBeNull();
    expect(host.audience).toBeDefined();
    expect(toCreateInput(d, false).audience).toBeUndefined();
  });
  test("giới hạn 10 ảnh, 2 video", () => {
    const img = (i: number) => ({ id: `i${i}`, kind: "image" as const, label: "" });
    expect(
      canAddMedia(
        Array.from({ length: 10 }, (_, i) => img(i)),
        "image",
      ),
    ).toBe(false);
    expect(
      canAddMedia(
        Array.from({ length: 9 }, (_, i) => img(i)),
        "image",
      ),
    ).toBe(true);
    expect(
      canAddMedia(
        [
          { id: "a", kind: "video", label: "" },
          { id: "b", kind: "video", label: "" },
        ],
        "video",
      ),
    ).toBe(false);
  });
  test("fact, thời gian, viết tắt", () => {
    expect(
      factRows({ type: "sell", fields: { product: "A", qty: "1", price: null } }),
    ).toContainEqual({ k: "Giá", v: "Liên hệ" });
    expect(
      factRows({
        type: "buy",
        fields: { product: "A", qty: "1", area: "HCM", neededBy: "2026-11-05" },
      }).find((f) => f.k === "Cần trước")?.v,
    ).toBe("05/11/2026");
    expect(timeAgo(new Date(Date.now() - 3 * 3600_000).toISOString())).toBe("3 giờ");
    expect(initials("Cơ sở Tân Phát")).toBe("TP");
    expect(expiryNote(new Date(Date.now() + 2 * 86_400_000).toISOString())).toBe(
      "Hết hạn sau 2 ngày",
    );
    expect(expiryNote(new Date(Date.now() + 20 * 86_400_000).toISOString())).toBeNull();
  });
});
