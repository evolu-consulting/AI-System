// HD-FR-07 · D-10: mapper hàng SQL → DTO (bigint chuỗi → số, giờ → ISO UTC, facet cắt ở trần + `truncated`) + literal mảng.
import { describe, expect, it } from "bun:test";
import { ContractDetailSchema, ContractFacetsSchema, ContractListRowSchema } from "@ai/contracts";
import {
  type FacetsRaw,
  toContractDetail,
  toContractFacets,
  toContractListRow,
} from "./contracts.mapper";
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

const T0 = "2026-03-01T07:00:00+07:00";
const NULLS = {
  parent_id: null,
  number: null,
  type: null,
  direction: null,
  seller: null,
  buyer: null,
  seller_signer: null,
  buyer_signer: null,
  value: null,
  end_date: null,
  action_deadline: null,
  error: null,
  confirmed_at: null,
  confirmed_by: null,
  handled: null,
  run_id: null,
  parent: null,
  appendices: null,
} as const;

describe("toContractDetail", () => {
  it("HD-AC12 · fields đủ 23 khoá (bỏ khoá lạ), giờ ISO UTC, items/events/clauses null ⇒ []; khớp ContractDetailSchema", () => {
    const d = toContractDetail({
      ...NULLS,
      id: U,
      kind: "contract",
      title: "HĐ",
      status: "needs_review",
      owner_user_id: U,
      updated_at: T0,
      version: 1,
      created_by: U,
      created_at: T0,
      file_id: U,
      clauses: null,
      warnings: null,
      fields: { number: { value: "HD-1", quote: "q", verified: true }, khoa_la: { value: 1 } },
      items: null,
      events: [{ id: 3, type: "uploaded", actor_user_id: null, at: T0, data: {} }],
      file: {
        id: U,
        name: "a.pdf",
        mime: "application/pdf",
        size_bytes: "10" as unknown as number,
      },
      has_source: false,
    });
    expect(ContractDetailSchema.parse(d)).toEqual(d);
    expect(Object.keys(d.fields)).toHaveLength(23);
    expect(d.fields.number).toEqual({ value: "HD-1", quote: "q", verified: true, edited: false });
    expect([d.items, d.clauses, d.events[0]?.at, d.file?.size_bytes, "category_ids" in d]).toEqual([
      [],
      [],
      "2026-03-01T00:00:00.000Z",
      10,
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
