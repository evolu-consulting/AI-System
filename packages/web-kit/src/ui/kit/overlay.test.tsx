// CR-177 U3 · nhóm B (lớp nổi, xác nhận): kiểm tĩnh — thuộc tính, hàm thuần, render tĩnh.
import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { pickCancelFocus } from "./alert-dialog";
import { filterOptions, foldText, moveActive } from "./combobox";
import { DialogBody, DialogContent, DialogFooter, DialogHeader } from "./dialog";
import { canConfirm } from "./inline-confirm";
import { SHEET_SIDE_CLASS } from "./sheet";

type El = ReactElement<{ children?: unknown; [k: string]: unknown }>;
const walk = (n: unknown, f: (e: El) => boolean): El | null => {
  if (Array.isArray(n)) return n.map((c) => walk(c, f)).find(Boolean) ?? null;
  if (!n || typeof n !== "object" || !("props" in n)) return null;
  const e = n as El;
  return f(e) ? e : walk(e.props.children, f);
};

describe("dialog", () => {
  test("dialog có aria-modal và vùng body cuộn riêng, header/footer cố định", () => {
    const tree = DialogContent({ children: "x" });
    expect(walk(tree, (e) => e.props["aria-modal"] === "true")).not.toBeNull();
    const cls = String(
      walk(tree, (e) => String(e.props.className ?? "").includes("max-h-[90vh]"))?.props.className,
    );
    expect(cls).toContain("max-h-[90vh]");
    expect(String(DialogBody({}).props.className)).toContain("overflow-y-auto");
    expect(String(DialogHeader({}).props.className)).toContain("shrink-0");
    expect(String(DialogFooter({}).props.className)).toContain("shrink-0");
  });
  test("sheet có ba phía trái, phải và dưới", () => {
    expect(Object.keys(SHEET_SIDE_CLASS).sort()).toEqual(["bottom", "left", "right"]);
  });
});

describe("alert-dialog", () => {
  test("danger đưa focus vào nút huỷ và chặn focus mặc định", () => {
    let focused = 0;
    let prevented = 0;
    pickCancelFocus(true, { focus: () => focused++ }, { preventDefault: () => prevented++ });
    expect([focused, prevented]).toEqual([1, 1]);
  });
  test("không danger thì giữ focus mặc định", () => {
    let focused = 0;
    pickCancelFocus(false, { focus: () => focused++ }, { preventDefault: () => {} });
    expect(focused).toBe(0);
  });
});

describe("combobox", () => {
  const opts = [
    { value: "1", label: "Báo giá" },
    { value: "2", label: "Hợp đồng" },
  ];
  test("gõ «bao gia» ra «Báo giá» (không phân biệt hoa/dấu)", () => {
    expect(filterOptions(opts, "bao gia").map((o) => o.label)).toEqual(["Báo giá"]);
    expect(foldText("Đơn")).toBe("don");
  });
  test("mũi tên đi vòng, Home/End nhảy đầu/cuối", () => {
    expect(moveActive("ArrowDown", 1, 2)).toBe(0);
    expect(moveActive("ArrowUp", 0, 2)).toBe(1);
    expect(moveActive("End", 0, 5)).toBe(4);
    expect(moveActive("a", 0, 5)).toBeNull();
  });
});

describe("inline-confirm", () => {
  test("nút xác nhận khoá khi ô bắt buộc còn trống, bật khi có chữ hoặc không bắt buộc", () => {
    expect(canConfirm(true, "  ")).toBe(false);
    expect(canConfirm(true, "lý do")).toBe(true);
    expect(canConfirm(false, "")).toBe(true);
  });
});
