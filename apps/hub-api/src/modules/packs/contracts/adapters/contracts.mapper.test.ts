// HD-FR-07 · D-10: mapper hàng SQL → DTO (bigint chuỗi → số, giờ → ISO UTC, facet cắt ở trần + `truncated`) + literal mảng.
import { describe, expect, it } from "bun:test";
import { ContractFacetsSchema, ContractListRowSchema } from "@ai/contracts";
import { type FacetsRaw, toContractFacets, toContractListRow } from "./contracts.mapper";
import { pgTextArray } from "./contracts.repo";

const U = "c0de0000-0000-4000-8000-000000000001";

describe("toContractListRow", () => {
  it("19 khoá, value số, updated_at ISO UTC, bỏ ord; khớp ContractListRowSchema", () => {
    const row = toContractListRow({
      id: U,
      kind: "contract",
      parent_id: null,
      title: "HĐ",
      number: null,
      type: null,
      direction: null,
      status: "active",
      seller: null,
      buyer: null,
      seller_signer: null,
      buyer_signer: null,
      value: "500000000",
      end_date: "2027-03-31",
      action_deadline: null,
      owner_user_id: U,
      category_ids: [],
      updated_at: "2026-03-01T07:00:00+07:00",
      version: 1,
      ord: 1,
    });
    expect(ContractListRowSchema.parse(row)).toEqual(row);
    expect([row.value, row.updated_at, "ord" in row]).toEqual([
      500_000_000,
      "2026-03-01T00:00:00.000Z",
      false,
    ]);
  });
});

describe("toContractFacets", () => {
  const empty: FacetsRaw = {
    status: null,
    direction: null,
    kind: null,
    owner: null,
    seller: null,
    buyer: null,
    signer: null,
    category: null,
    value: null,
  };
  it("tenant rỗng ⇒ mảng rỗng, value null, truncated rỗng", () => {
    const f = toContractFacets(empty, { text: 500, category: 200 });
    expect(ContractFacetsSchema.parse(f)).toEqual(f);
    expect([f.seller, f.value, f.truncated]).toEqual([[], null, []]);
  });
  it("vượt trần ⇒ cắt và ghi truncated; json dạng chuỗi cũng đọc được; min/max chuỗi ⇒ số", () => {
    const sellers = JSON.stringify([1, 2, 3].map((i) => ({ v: `s${i}`, n: 1 })));
    const f = toContractFacets(
      { ...empty, seller: sellers, value: { min: "1", max: "9" } },
      { text: 2, category: 2 },
    );
    expect([f.seller.length, f.truncated, f.value]).toEqual([2, ["seller"], { min: 1, max: 9 }]);
  });
});

describe("pgTextArray", () => {
  it('null giữ null; thoát " và \\', () => {
    expect(pgTextArray(null)).toBeNull();
    expect(pgTextArray(['a"b', "c\\d", "x,y"])).toBe('{"a\\"b","c\\\\d","x,y"}');
  });
});
