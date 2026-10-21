// HD-FR-51 · S03: nhãn/tên rút gọn, lựa chọn lọc từ facets, truy vấn server từ bộ lọc.
import { describe, expect, test } from "bun:test";
import type { ContractFacets } from "@ai/contracts";
import { exportQueryString, filterMaps, listQueryString, personOf, shortName } from "./list-model";

const facets = {
  status: [
    { v: "renewed", n: 1 },
    { v: "active", n: 5 },
    { v: "terminated", n: 2 },
  ],
  direction: [
    { v: "unknown", n: 1 },
    { v: "purchase", n: 3 },
  ],
  kind: [],
  owner: [{ v: "u1", n: 2 }],
  seller: [
    { v: "CÔNG TY TNHH BAO BÌ PHƯƠNG NAM", n: 2 },
    { v: "Cty Bao Bì Phương Nam", n: 1 },
  ],
  buyer: [],
  signer: [{ v: "nguyen van a", label: "Nguyễn Văn A – Giám đốc", n: 2 }],
  category: [{ v: "c1", label: "Bao bì", n: 4 }],
  value: { min: 1, max: 9 },
  truncated: [],
} as ContractFacets;

describe("tên hiển thị", () => {
  test("shortName bỏ loại hình, viết hoa đầu từ khi tên toàn hoa; rỗng ⇒ —", () => {
    expect(shortName("CÔNG TY TNHH BAO BÌ PHƯƠNG NAM")).toBe("Bao Bì Phương Nam");
    expect(shortName(null)).toBe("—");
  });
  test("personOf cắt chức danh", () => {
    expect(personOf("Nguyễn Văn A – Giám đốc")).toBe("Nguyễn Văn A");
    expect(personOf("Trần B, Phó GĐ")).toBe("Trần B");
  });
});

describe("filterMaps", () => {
  const m = filterMaps(facets, new Map([["u1", "Lan"]]));
  test("trạng thái cùng nhãn gộp (Đã xử lý = renewed + terminated), theo thứ tự trạng thái", () => {
    expect(m.status.map((s) => s.label)).toEqual(["Đang hiệu lực", "Đã xử lý"]);
    expect(m.status[1]?.values).toEqual(["renewed", "terminated"]);
  });
  test("bên bán cùng tên rút gọn gộp về một lựa chọn, giữ cả hai giá trị thô", () => {
    expect(m.seller).toEqual([
      {
        label: "Bao Bì Phương Nam",
        values: ["CÔNG TY TNHH BAO BÌ PHƯƠNG NAM", "Cty Bao Bì Phương Nam"],
      },
    ]);
  });
  test("mua/bán giữ thứ tự facets; phụ trách theo danh bạ, không có ⇒ (không rõ); người ký bỏ chức danh", () => {
    expect(m.direction.map((d) => d.label)).toEqual(["Chưa rõ", "Mua vào"]);
    expect(m.owner).toEqual([{ label: "Lan", values: ["u1"] }]);
    expect(m.signer).toEqual([{ label: "Nguyễn Văn A", values: ["Nguyễn Văn A – Giám đốc"] }]);
    expect(filterMaps(facets, new Map()).owner[0]?.label).toBe("(không rõ)");
  });
  test("chưa có facets ⇒ không lựa chọn", () => {
    expect(filterMaps(undefined, new Map()).status).toEqual([]);
  });
});

describe("listQueryString", () => {
  const maps = filterMaps(facets, new Map([["u1", "Lan"]]));
  const base = { q: "", conds: {}, maps, page: 1, pageSize: 20 };
  test("không lọc ⇒ chỉ include=progress (V2-F) + page/page_size", () => {
    expect(listQueryString(base)).toBe("include=progress&page=1&page_size=20");
  });
  test("q < 2 ký tự bị bỏ; chọn nhãn ⇒ tham số lặp theo giá trị thô; khoảng giá trị", () => {
    const qs = new URLSearchParams(
      listQueryString({
        ...base,
        q: " a ",
        page: 3,
        conds: {
          status: { in: ["Đã xử lý"] },
          seller: { in: ["Bao Bì Phương Nam"] },
          category: { in: ["Bao bì"] },
          value: { min: 100, max: null },
        },
      }),
    );
    expect(qs.has("q")).toBe(false);
    expect(qs.getAll("status")).toEqual(["renewed", "terminated"]);
    expect(qs.getAll("seller")).toHaveLength(2);
    expect(qs.getAll("category")).toEqual(["c1"]);
    expect([qs.get("value_min"), qs.get("value_max"), qs.get("page")]).toEqual(["100", null, "3"]);
    expect(new URLSearchParams(listQueryString({ ...base, q: "bao bì" })).get("q")).toBe("bao bì");
  });
  test("nhãn không còn trong facets ⇒ không lọc (không gửi tham số rỗng)", () => {
    expect(listQueryString({ ...base, conds: { status: { in: ["Không có"] } } })).toBe(
      "include=progress&page=1&page_size=20",
    );
  });
});

describe("Gap #8/#10 · lọc ngày + xuất tệp (cùng bộ lọc với danh sách)", () => {
  const base = {
    q: "abc",
    conds: { value: { min: 5 } },
    maps: filterMaps(undefined, new Map()),
    page: 3,
    pageSize: 50,
  };
  test("lọc ngày vào danh sách: due thắng; khoảng; không lọc ⇒ không thêm tham số", () => {
    expect(listQueryString(base)).not.toContain("date_");
    expect(
      listQueryString({ ...base, date: { field: "action_deadline", due: "overdue" } }),
    ).toContain("date_field=action_deadline&due=overdue");
    const r = listQueryString({
      ...base,
      date: { field: "end_date", from: "2026-01-01", to: "2026-02-01" },
    });
    expect(r).toContain("date_from=2026-01-01&date_to=2026-02-01");
  });
  test("xuất tệp: giữ q/giá trị/ngày, bỏ page/page_size/include, thêm format", () => {
    const qs = exportQueryString({ ...base, date: { field: "end_date", due: "30" } }, "csv");
    const u = new URLSearchParams(qs);
    expect(Object.fromEntries(u)).toEqual({
      q: "abc",
      value_min: "5",
      date_field: "end_date",
      due: "30",
      format: "csv",
    });
  });
});
