import { describe, expect, test } from "bun:test";
import type { ContractListResponse } from "@ai/contracts";
import { buildRows, countQuery, docTypeParams, parseDocFilter } from "./doc-list";
import { exportQueryString, type ListParams, listQueryString } from "./list-model";

const id = (n: number) => `c0000000-0000-4000-8000-00000000000${n}`;
const item = (n: number) =>
  ({ id: id(n), title: `HĐ ${n}` }) as ContractListResponse["items"][number];
const doc = (n: number, doc_type: "contract" | "framework" | "deal") => ({
  id: id(n),
  doc_type,
  frame_root_id: null,
  root_id: id(n),
  source: null,
  frame_restricted: false,
});
const kid = (parent: number, n: number) => ({
  frame_root_id: id(parent),
  id: id(n),
  doc_type: "deal" as const,
  title: `GD ${n}`,
  number: null,
  status: "active",
  value: 1000,
});
const resp = (over: Partial<ContractListResponse>): ContractListResponse => ({
  items: [],
  total: 0,
  parents: [],
  page: 1,
  page_size: 20,
  ...over,
});

describe("bộ lọc loại", () => {
  test("parseDocFilter: giá trị lạ ⇒ Tất cả", () => {
    expect(parseDocFilter("deal")).toBe("deal");
    expect(parseDocFilter("framework")).toBe("framework");
    expect(parseDocFilter("x")).toBe("all");
    expect(parseDocFilter(undefined)).toBe("all");
  });
  test("tham số API: Tất cả/HĐ NT gom con (nest), HĐ kinh tế/Giao dịch lọc phẳng", () => {
    expect(docTypeParams("all")).toEqual([["nest", "1"]]);
    expect(docTypeParams("framework")).toEqual([
      ["doc_type", "framework"],
      ["nest", "1"],
    ]);
    expect(docTypeParams("deal")).toEqual([["doc_type", "deal"]]);
    expect(docTypeParams("contract")).toEqual([["doc_type", "contract"]]);
  });
  test("truy vấn đếm lấy 1 dòng", () => {
    expect(countQuery("deal")).toBe("doc_type=deal&page=1&page_size=1");
  });
  test("chuỗi truy vấn danh sách/xuất tệp mang loại", () => {
    const p: ListParams = {
      q: "",
      conds: {},
      maps: {
        category: [],
        direction: [],
        seller: [],
        buyer: [],
        owner: [],
        signer: [],
        status: [],
      },
      page: 1,
      pageSize: 20,
      docType: "deal",
    };
    const qs = new URLSearchParams(listQueryString(p));
    expect(qs.get("doc_type")).toBe("deal");
    expect(qs.has("nest")).toBe(false);
    expect(qs.get("include")).toBe("progress");
    expect(new URLSearchParams(listQueryString({ ...p, docType: "all" })).get("nest")).toBe("1");
    const ex = new URLSearchParams(exportQueryString({ ...p, docType: "framework" }, "csv"));
    expect(ex.get("doc_type")).toBe("framework");
    expect(ex.has("nest")).toBe(false);
  });
});

describe("buildRows", () => {
  test("không có docs (phản hồi cũ) ⇒ mọi hàng là HĐ kinh tế", () => {
    const rows = buildRows(resp({ items: [item(1), item(2)] }));
    expect(rows.map((r) => r.kind === "item" && r.doc)).toEqual(["contract", "contract"]);
  });
  test("con thụt ngay dưới HĐ nguyên tắc của nó, đúng thứ tự", () => {
    const rows = buildRows(
      resp({
        items: [item(1), item(2), item(3)],
        docs: [doc(1, "contract"), doc(2, "framework"), doc(3, "deal")],
        children: [kid(2, 4), kid(2, 5)],
      }),
    );
    expect(rows.map((r) => (r.kind === "item" ? r.item.id : `child:${r.child.id}`))).toEqual([
      id(1),
      id(2),
      `child:${id(4)}`,
      `child:${id(5)}`,
      id(3),
    ]);
    expect(rows.every((r) => r.kind === "item" || !r.orphan)).toBe(true);
  });
  test("HĐ NT phiên bản 2 (id ≠ root_id): con khớp theo root_id", () => {
    const v2 = { ...doc(2, "framework"), root_id: id(7) };
    const rows = buildRows(
      resp({ items: [item(2)], docs: [v2], children: [kid(7, 4), kid(2, 5)] }),
    );
    expect(rows.map((r) => (r.kind === "item" ? "item" : `${r.child.id}:${r.orphan}`))).toEqual([
      "item",
      `${id(4)}:false`,
      `${id(5)}:true`,
    ]);
  });
  test("con không khớp hàng cha nào ⇒ cuối danh sách, đánh dấu orphan (không mất dòng)", () => {
    const rows = buildRows(
      resp({ items: [item(1)], docs: [doc(1, "framework")], children: [kid(9, 4)] }),
    );
    const last = rows[rows.length - 1];
    expect(last?.kind === "child" && last.orphan).toBe(true);
  });
  test("chưa có dữ liệu ⇒ rỗng", () => {
    expect(buildRows(undefined)).toEqual([]);
  });
});
