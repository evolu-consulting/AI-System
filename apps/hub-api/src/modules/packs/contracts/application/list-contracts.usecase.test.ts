// HD-FR-07 · HD-AC04 · HD-BR-03 · D-03: `toListFilter` (thuần) + use case danh sách qua `PackUow` giả.
import { describe, expect, it } from "bun:test";
import { listContracts, toListFilter } from "./list-contracts.usecase";
import type { ContractListFilter, ContractListInput } from "./ports";

const base: ContractListInput = { sort: "updated_at", dir: "desc", page: 1, page_size: 20 };

describe("toListFilter", () => {
  it("không lọc ⇒ mọi bộ lọc null; trang 1 ⇒ offset 0", () => {
    expect(toListFilter(base)).toEqual({
      status: null,
      owner: null,
      category: null,
      seller: null,
      buyer: null,
      signerKeys: null,
      direction: null,
      kind: null,
      valueMin: null,
      valueMax: null,
      like: null,
      order: "updated_at:desc",
      limit: 20,
      offset: 0,
    });
  });
  it("signer ⇒ khoá người (bỏ dấu, cắt chức danh, khử trùng); chỉ chức danh ⇒ [] (không khớp gì)", () => {
    const f = toListFilter({ ...base, signer: [" Nguyễn Văn  A ", "nguyen van a – Giám đốc"] });
    expect(f.signerKeys).toEqual(["nguyen van a"]);
    expect(toListFilter({ ...base, signer: [", Giám đốc"] }).signerKeys).toEqual([]);
  });
  it("q ⇒ LIKE đã fold, thoát % _ \\, bọc %", () => {
    expect(toListFilter({ ...base, q: "Giảm 100%_" }).like).toBe("%giam 100\\%\\_%");
  });
  it("page/page_size ⇒ limit/offset; sort+dir ⇒ order; value biên giữ nguyên (0 không thành null)", () => {
    const f = toListFilter({
      ...base,
      page: 500,
      page_size: 20,
      sort: "value",
      dir: "asc",
      value_min: 0,
    });
    expect([f.limit, f.offset, f.order, f.valueMin, f.valueMax]).toEqual([
      20,
      9980,
      "value:asc",
      0,
      null,
    ]);
  });
});

describe("listContracts", () => {
  it("một tx tenant; trả items/total + page/page_size của đầu vào", async () => {
    const seen: { who: unknown; f: ContractListFilter }[] = [];
    const uow = {
      tenant: <T>(who: unknown, fn: (r: never) => Promise<T>) =>
        fn({
          contracts: {
            list: async (f: ContractListFilter) => {
              seen.push({ who, f });
              return { total: 7, items: ["r"], parents: [] };
            },
          },
        } as never),
    };
    const out = await listContracts<string>({ uow })(
      { tenantId: "t", userId: "u" },
      {
        ...base,
        page: 2,
        page_size: 5,
      },
    );
    expect(out).toEqual({
      items: ["r"],
      total: 7,
      parents: [],
      page: 2,
      page_size: 5,
    });
    expect(seen.map((s) => [s.who, s.f.offset])).toEqual([[{ tenantId: "t", userId: "u" }, 5]]);
  });
});
