// HD-FR-07 · HD-AC04 · HD-BR-03 · D-03: `toListFilter` (thuần) + use case danh sách qua `PackUow` giả.
import { describe, expect, it } from "bun:test";
import { addDays, dateWindow, listContracts, toListFilter } from "./list-contracts.usecase";
import type { ContractListFilter, ContractListInput } from "./ports";

const base: ContractListInput = { sort: "updated_at", dir: "desc", page: 1, page_size: 20 };

describe("toListFilter", () => {
  it("CR-101: doc_type ⇒ lọc + docs; nest=1 ⇒ nest + docs", () => {
    const a = toListFilter({ ...base, doc_type: ["framework"] });
    const b = toListFilter({ ...base, nest: "1" });
    expect([a.docType, a.nest, a.docs, b.docType, b.nest, b.docs]).toEqual([
      ["framework"],
      false,
      true,
      null,
      true,
      true,
    ]);
  });
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
      docType: null,
      nest: false,
      docs: false,
      valueMin: null,
      valueMax: null,
      dateField: "end_date",
      dateFrom: null,
      dateTo: null,
      like: null,
      order: "updated_at:desc",
      limit: 20,
      offset: 0,
    });
  });
});

describe("Gap #10 · cửa sổ ngày của bộ lọc", () => {
  it("quá hạn = < hôm nay; 30/60/90 = hôm nay…+N; khoảng tuỳ chọn; due thắng khoảng", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    const today = "2026-10-21";
    expect(dateWindow({ due: "overdue" }, today)).toEqual({ from: null, to: "2026-10-20" });
    expect(dateWindow({ due: "30" }, today)).toEqual({ from: today, to: "2026-11-20" });
    expect(dateWindow({ due: "90" }, today)).toEqual({ from: today, to: "2027-01-19" });
    expect(dateWindow({ date_from: "2026-01-01", date_to: "2026-02-01" }, today)).toEqual({
      from: "2026-01-01",
      to: "2026-02-01",
    });
    expect(dateWindow({ due: "60", date_from: "2020-01-01" }, today).from).toBe(today);
    const f = toListFilter({ ...base, date_field: "action_deadline", due: "overdue" }, today);
    expect([f.dateField, f.dateFrom, f.dateTo]).toEqual(["action_deadline", null, "2026-10-20"]);
  });
});

describe("toListFilter (tiếp)", () => {
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
