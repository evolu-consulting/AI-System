// CR-102b · unit luật thuần Lưu báo giá + gợi ý (nguồn hợp lệ, lô một lần, gợi ý từ kết quả đọc).
import { describe, expect, it } from "bun:test";
import { hostHintOf, pageQuery, quoteSourceOk, toPortInput } from "./quote.rules";

describe("quote.rules", () => {
  it("nguồn hợp lệ: bài Cần bán của đối tác; bình luận đối tác trên Cần mua của chủ quản", () => {
    expect(quoteSourceOk({ type: "sell", author_org: "o" }, null)).toBe(true);
    expect(quoteSourceOk({ type: "sell", author_org: null }, null)).toBe(false);
    expect(quoteSourceOk({ type: "buy", author_org: "o" }, null)).toBe(false);
    expect(quoteSourceOk({ type: "buy", author_org: null }, { author_org: "o" })).toBe(true);
    expect(quoteSourceOk({ type: "buy", author_org: null }, { author_org: null })).toBe(false);
    expect(quoteSourceOk({ type: "buy", author_org: "o" }, { author_org: "o" })).toBe(false);
  });
  it("pageQuery: một lô, bỏ bài chủ quản/Thông báo, khoá đối tác chỉ của Cần bán, không trùng", () => {
    const q = pageQuery([
      { id: "1", type: "sell", author_org: "a", fields: { product: " X " }, party_key: "k" },
      { id: "2", type: "sell", author_org: "a", fields: { product: "Y" }, party_key: "k" },
      { id: "3", type: "buy", author_org: "b", fields: { product: "Z" }, party_key: "kb" },
      { id: "4", type: "sell", author_org: null, fields: { product: "H" }, party_key: null },
      { id: "5", type: "note", author_org: "a", fields: {}, party_key: null },
    ]);
    expect(q.postIds).toEqual(["1", "2", "3"]);
    expect(q.hints[0]).toEqual({ name: "X" });
    expect(q.partyKeys).toEqual(["k"]);
  });
  it("hostHintOf: giá thấp nhất, uy tín, có hàng", () => {
    const h = hostHintOf(
      {
        index: 0,
        hint: {},
        match: { id: "p", name: "N", unit: "bao", how: "exact" },
        onHand: "5",
        avgCost: 100,
        prices: [
          {
            supplierName: "A",
            supplierPartyKey: null,
            price: 9,
            unit: "bao",
            source: "quote",
            seenOn: "2026-10-01",
            vatIncluded: null,
            expiresOn: null,
          },
          {
            supplierName: "B",
            supplierPartyKey: null,
            price: 7,
            unit: "bao",
            source: "quote",
            seenOn: "2026-10-02",
            vatIncluded: true,
            expiresOn: null,
          },
        ],
      },
      [{ partyKey: "k", band: "good", score: 90 }],
      "k",
    );
    expect(h).toMatchObject({
      inStock: true,
      best: { price: 7, supplier: "B" },
      reputation: { band: "good", score: 90 },
    });
  });
  it("toPortInput: NCC do server; origin_ref có bài + mặt hàng + bình luận", () => {
    const i = toPortInput(
      {
        price: 5,
        vatIncluded: true,
        kind: "new",
        quotedAt: "2026-10-28",
        notify: true,
        unit: " cái ",
        productId: "p",
        itemIdx: 1,
        commentId: "c",
      } as never,
      { postId: "post", supplierName: "NCC", partyKey: null, url: null },
    );
    expect(i).toMatchObject({
      product_id: "p",
      unit: "cái",
      supplier: { name: "NCC" },
      origin_ref: { pack: "community", post_id: "post", item_idx: 1, comment_id: "c" },
    });
  });
});
