// CR-127 · U2b · nút Lên / Xuống / Xoá của dòng bước (render tĩnh: trạng thái tắt/ẩn theo vị trí và chế độ chỉ xem).
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StepRow, type StepRowProps } from "./OutlineRows";

const base: StepRowProps = {
  uid: "s1",
  title: "Duyệt giám đốc",
  kind: "Duyệt",
  summary: "cần tất cả",
  errors: 0,
  warn: false,
  selected: false,
  readOnly: false,
  canUp: true,
  canDown: true,
  onSelect: () => {},
  onMove: () => {},
  onRemove: () => {},
};
const html = (p: Partial<StepRowProps>) => renderToStaticMarkup(<StepRow {...base} {...p} />);
const btn = (h: string, key: string) =>
  h.match(new RegExp(`<button[^>]*aria-label="${key}"[^>]*>`))?.[0];

describe("StepRow", () => {
  test("đầu danh sách: Lên tắt, Xuống bật, Xoá có", () => {
    const h = html({ canUp: false });
    expect(btn(h, "process.admin.flow.outline.up")).toContain('disabled=""');
    expect(btn(h, "process.admin.flow.outline.down")).not.toContain('disabled=""');
    expect(btn(h, "process.admin.flow.outline.remove")).toBeDefined();
  });
  test("chỉ xem: không có nút nào", () => {
    const h = html({ readOnly: true });
    expect(btn(h, "process.admin.flow.outline.remove")).toBeUndefined();
  });
  test("lỗi ⇒ chip Cần sửa; chỉ lưu ý ⇒ chip Lưu ý", () => {
    expect(html({ errors: 2 })).toContain("outline-chip-error");
    expect(html({ warn: true })).toContain("outline-chip-warn");
    expect(html({})).not.toContain("outline-chip");
  });
});
