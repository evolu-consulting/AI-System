// PK-FR-10 · TF6 · test đơn vị bảng: bỏ dấu tiếng Việt, lọc cột, phân trang (client + server D-03), cột ẩn, render tĩnh Pager/ColumnPicker.
import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { i18n, initI18n } from "~/app/i18n";
import { ColumnPicker } from "./ColumnPicker";
import { summaryOf } from "./CondEditors";
import {
  applyFilters,
  type ColumnFilter,
  isSet,
  matches,
  normalize,
  optionsOf,
  pageList,
  paginate,
} from "./lib";
import { Pager } from "./Pager";
import { TableTools } from "./TableTools";
import { useColumns } from "./use-columns";

beforeAll(async () => {
  await initI18n();
  await i18n.changeLanguage("vi");
});

type Row = { name: string; seller: string; cats: string[]; value: number };
const rows: Row[] = [
  { name: "HĐ Hà Nội", seller: "Nhựa Đông Á", cats: ["Bao bì", "Gia vị"], value: 100 },
  { name: "HĐ Đức", seller: "Bao Bì Phương Nam", cats: ["Bao bì"], value: 500 },
  { name: "HĐ Huế", seller: "Nhựa Đông Á", cats: [], value: 900 },
];
const filters: ColumnFilter<Row>[] = [
  { key: "seller", label: "Bên bán", value: (r) => r.seller },
  { key: "cat", label: "Loại", value: (r) => r.cats },
  { key: "value", label: "Giá trị", value: (r) => r.value, kind: "number" },
];

describe("bỏ dấu tiếng Việt", () => {
  test("normalize: Hà Nội → ha noi, Đức → duc, đ/Đ cùng một chữ", () => {
    expect(normalize("Hà Nội")).toBe("ha noi");
    expect(normalize("Đức")).toBe("duc");
    expect(normalize("đồng ĐÁ")).toBe("dong da");
  });
  test("matches: mọi từ phải có; query rỗng khớp hết; không dấu khớp có dấu", () => {
    expect(matches("Nhựa Đông Á · Hà Nội", "nhua dong a")).toBe(true);
    expect(matches("Nhựa Đông Á", "nhua phuong")).toBe(false);
    expect(matches("bất kỳ", "   ")).toBe(true);
    expect(matches("Hợp đồng mua bán", "HOP DONG")).toBe(true);
  });
});

describe("lọc cột", () => {
  test("optionsOf: giá trị khác nhau, bỏ rỗng, sắp tiếng Việt, cột nhiều giá trị", () => {
    expect(optionsOf(rows, (r) => r.cats)).toEqual(["Bao bì", "Gia vị"]);
    expect(optionsOf(rows, (r) => r.seller)).toEqual(["Bao Bì Phương Nam", "Nhựa Đông Á"]);
    expect(optionsOf([{ v: " " }, { v: null }], (r) => r.v)).toEqual([]);
  });
  test("isSet: trường vừa thêm chưa chọn gì thì không ràng buộc", () => {
    expect(isSet(undefined)).toBe(false);
    expect(isSet({ in: [] })).toBe(false);
    expect(isSet({ in: ["a"] })).toBe(true);
    expect(isSet({ min: 0 })).toBe(true);
  });
  test("applyFilters: giữ dòng có BẤT KỲ giá trị đã chọn; hai cột là VÀ; khoảng số", () => {
    expect(applyFilters(rows, filters, { cat: { in: ["Gia vị"] } }).map((r) => r.name)).toEqual([
      "HĐ Hà Nội",
    ]);
    expect(
      applyFilters(rows, filters, { seller: { in: ["Nhựa Đông Á"] }, cat: { in: ["Bao bì"] } })
        .length,
    ).toBe(1);
    expect(
      applyFilters(rows, filters, { value: { min: 200, max: 600 } }).map((r) => r.value),
    ).toEqual([500]);
    expect(applyFilters(rows, filters, { value: { min: 600 } }).length).toBe(1);
    expect(applyFilters(rows, filters, { seller: { in: [] } })).toBe(rows);
  });
  test("summaryOf: giá trị đầu + số còn lại, hoặc khoảng", () => {
    const t = (k: string, o?: Record<string, unknown>) => `${k}:${o?.value ?? ""}`;
    const v = { key: "s", label: "S", kind: "values" as const, options: [] };
    const n = { ...v, kind: "number" as const };
    expect(summaryOf(v, { in: ["A", "B", "C"] }, t, true)).toBe("A +2");
    expect(summaryOf(v, undefined, t, false)).toBe("contracts.table.pick:");
    expect(summaryOf(n, { min: 1000, max: 2000 }, t, true)).toBe("1.000 – 2.000");
    expect(summaryOf(n, { min: 1000 }, t, true)).toBe("contracts.table.from:1.000");
  });
});

describe("phân trang", () => {
  const many = Array.from({ length: 57 }, (_, i) => i + 1);
  test("paginate: 57 dòng/20 ⇒ 3 trang; trang cuối 17 dòng; kẹp page ngoài khoảng", () => {
    expect(paginate(many, 1, 20)).toMatchObject({ pages: 3, page: 1 });
    expect(paginate(many, 3, 20).shown).toHaveLength(17);
    expect(paginate(many, 99, 20).page).toBe(3);
    expect(paginate(many, -4, 20).page).toBe(1);
    expect(paginate([], 1, 20)).toMatchObject({ pages: 1, page: 1, shown: [] });
  });
  test("pageList: ≤ 7 trang đủ hết; nhiều thì trang đầu/cuối/quanh hiện tại có …", () => {
    expect(pageList(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageList(1, 20)).toEqual([1, 2, "…", 20]);
    expect(pageList(10, 20)).toEqual([1, "…", 9, 10, 11, "…", 20]);
    expect(pageList(20, 20)).toEqual([1, "…", 19, 20]);
  });
  test("Pager (D-03: page/total): '21–40 / 57 dòng', aria-label cũ, trang hiện tại có aria-current", () => {
    const html = renderToStaticMarkup(
      <Pager
        t={{ page: 2, pages: 3, setPage: () => {}, total: 57, pageSize: 20, setPageSize: () => {} }}
      />,
    );
    expect(html).toContain("21–40 / 57 dòng");
    expect(html).toContain('aria-label="Phân trang"');
    expect(html).toContain('aria-label="Trang trước"');
    expect(html).toMatch(/aria-current="page"[^>]*>2</);
    expect(html).toContain('<option value="100"');
  });
  test("Pager: rỗng ⇒ '0–0 / 0 dòng', hai nút mũi tên khoá", () => {
    const html = renderToStaticMarkup(
      <Pager
        t={{ page: 1, pages: 1, setPage: () => {}, total: 0, pageSize: 20, setPageSize: () => {} }}
      />,
    );
    expect(html).toContain("0–0 / 0 dòng");
    expect(html.match(/disabled=""/g)?.length).toBe(2);
  });
});

describe("cột hiển thị + công cụ bảng", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
  });
  // useColumns là hook: gọi trong một component render tĩnh để lấy trạng thái khởi tạo.
  function initial(key: string) {
    let out: ReturnType<typeof useColumns> | undefined;
    const cols = [
      { key: "a", label: "A", locked: true },
      { key: "b", label: "B" },
      { key: "c", label: "C" },
    ];
    function Probe() {
      out = useColumns(key, cols);
      return null;
    }
    renderToStaticMarkup(<Probe />);
    return out as ReturnType<typeof useColumns>;
  }
  test("đọc cột ẩn đã lưu, bỏ khoá lạ; hỏng JSON ⇒ hiện hết", () => {
    store.set("cols:t", JSON.stringify(["b", "zzz"]));
    const c = initial("t");
    expect(c.shows("b")).toBe(false);
    expect(c.shows("c")).toBe(true);
    expect(c.hiddenCount).toBe(1);
    store.set("cols:bad", "{không phải json");
    expect(initial("bad").hiddenCount).toBe(0);
  });
  test("ColumnPicker: nhãn có số cột ẩn, cột khoá bị disabled (nội dung popover chỉ hiện khi mở)", () => {
    store.set("cols:t", JSON.stringify(["b"]));
    const html = renderToStaticMarkup(<ColumnPicker cols={initial("t")} />);
    expect(html).toContain("Cột · ẩn 1");
    expect(html).toContain('aria-label="Cột hiển thị"');
  });
  test("TableTools: ô tìm có aria-label, số kết quả vi-VN trong role=status", () => {
    const html = renderToStaticMarkup(<TableTools q="" setQ={() => {}} total={12345} />);
    expect(html).toContain('aria-label="Tìm kiếm"');
    expect(html).toContain("12.345 kết quả");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("Xoá tìm kiếm");
    expect(renderToStaticMarkup(<TableTools q="x" setQ={() => {}} total={1} />)).toContain(
      "Xoá tìm kiếm",
    );
  });
});
