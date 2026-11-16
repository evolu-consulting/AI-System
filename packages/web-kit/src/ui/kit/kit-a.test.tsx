// CR-177 U2 · nhóm A của bộ component chung: biến thể/cỡ, khoá kèm lý do, đang xử lý, aria, badge, avatar, field.
import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { Avatar, AvatarGroup } from "./avatar";
import { Badge } from "./badge";
import { Button } from "./button";
import { Field } from "./field";
import { Input } from "./input";
import { TOOLTIP_DELAY_MS, Tooltip } from "./tooltip";

type El = ReactElement<Record<string, unknown> & { children?: unknown }>;
const kids = (n: unknown): unknown[] =>
  Array.isArray(n) ? n.flatMap(kids) : n === undefined || n === null || n === false ? [] : [n];
const isEl = (n: unknown): n is El => typeof n === "object" && n !== null && "props" in n;
/** Duyệt cây phần tử (không gọi component con), trả mọi phần tử khớp. */
function findAll(n: unknown, pred: (e: El) => boolean): El[] {
  if (!isEl(n)) return [];
  return [...(pred(n) ? [n] : []), ...kids(n.props.children).flatMap((c) => findAll(c, pred))];
}
const cls = (e: El) => String(e.props.className);
const fakeClick = () => {
  let prevented = false;
  return { e: { preventDefault: () => (prevented = true) }, was: () => prevented };
};

describe("Button", () => {
  test("biến thể ra đúng class", () => {
    const c = (variant: "primary" | "outline" | "quiet" | "danger") =>
      cls(Button({ variant }) as El);
    expect(c("primary")).toContain("bg-primary");
    expect(c("outline")).toContain("border-primary");
    expect(c("quiet")).toContain("border-input");
    expect(c("danger")).toContain("text-danger");
  });
  test("cỡ md/sm/icon theo --control-* và bo góc", () => {
    expect(cls(Button({}) as El)).toContain("h-[var(--control-md)]");
    expect(cls(Button({}) as El)).toContain("rounded-md");
    expect(cls(Button({ size: "sm" }) as El)).toContain("h-[var(--control-sm)]");
    expect(cls(Button({ size: "sm" }) as El)).toContain("rounded-sm");
    const icon = Button({ size: "icon", "aria-label": "Đóng" }) as El;
    expect(cls(icon)).toContain("size-[var(--control-md)]");
    expect(cls(icon)).toContain("active:scale-[.97]");
    expect(cls(icon)).toContain("duration-[var(--duration-fast)]");
  });
  test("className ngoài gộp qua cn (ghi đè class xung đột)", () => {
    expect(cls(Button({ className: "rounded-lg" }) as El)).toContain("rounded-lg");
    expect(cls(Button({ className: "rounded-lg" }) as El)).not.toContain("rounded-md");
  });
  test("disabledReason ⇒ aria-disabled, không gọi onClick, bọc Tooltip có lý do", () => {
    let n = 0;
    const el = Button({ disabledReason: "Chưa đủ quyền", onClick: () => n++ }) as El;
    expect(el.type).toBe(Tooltip);
    const btn = findAll(el, (x) => x.props["data-slot"] === "button")[0] as El;
    expect(btn.props["aria-disabled"]).toBe("true");
    expect(btn.props.disabled).toBeUndefined();
    const k = fakeClick();
    (btn.props.onClick as (e: unknown) => void)(k.e);
    expect(n).toBe(0);
    expect(k.was()).toBe(true);
    const content = findAll(
      el,
      (x) => x.props["data-slot"] === undefined && x.props.children === "Chưa đủ quyền",
    );
    expect(content.length).toBe(1);
  });
  test("không khoá ⇒ gọi onClick, không aria-disabled", () => {
    let n = 0;
    const btn = Button({ onClick: () => n++ }) as El;
    expect(btn.props["aria-disabled"]).toBeUndefined();
    (btn.props.onClick as (e: unknown) => void)(fakeClick().e);
    expect(n).toBe(1);
  });
  test("busy ⇒ aria-busy, spinner, chặn click, vẫn giữ nhãn (giữ chiều rộng)", () => {
    let n = 0;
    const btn = Button({ busy: true, onClick: () => n++, children: "Lưu" }) as El;
    expect(btn.props["aria-busy"]).toBe("true");
    (btn.props.onClick as (e: unknown) => void)(fakeClick().e);
    expect(n).toBe(0);
    expect(findAll(btn, (x) => x.props["data-slot"] === "button-spinner").length).toBe(1);
    expect(findAll(btn, (x) => x.props.children === "Lưu" && /invisible/.test(cls(x))).length).toBe(
      1,
    );
  });
  test("nút chỉ icon thiếu aria-label ⇒ lỗi kiểu", () => {
    // @ts-expect-error size="icon" bắt buộc aria-label
    Button({ size: "icon" });
    expect(true).toBe(true);
  });
});

describe("Tooltip", () => {
  test("trễ 250ms", () => {
    expect(TOOLTIP_DELAY_MS).toBe(250);
    const el = Tooltip({ children: null }) as El;
    expect(el.props.delayDuration).toBe(250);
  });
});

describe("Input / Field", () => {
  test("Input cao control-md, có viền danger khi aria-invalid, nền muted khi disabled", () => {
    const c = cls(Input({}) as El);
    expect(c).toContain("h-[var(--control-md)]");
    expect(c).toContain("aria-invalid:border-error-border");
    expect(c).toContain("disabled:bg-muted");
  });
  test("Field gắn id, aria-describedby (mô tả + lỗi) và aria-invalid vào control", () => {
    const el = Field({
      id: "ten",
      label: "Tên",
      description: "Tên hiển thị",
      error: "Bắt buộc",
      children: <Input />,
    }) as El;
    const input = findAll(
      el,
      (x) => x.props["data-slot"] === undefined && x.props.id === "ten",
    )[0] as El;
    expect(input.props["aria-describedby"]).toBe("ten-desc ten-err");
    expect(input.props["aria-invalid"]).toBe(true);
    expect(findAll(el, (x) => x.props.id === "ten-err" && x.props.role === "alert").length).toBe(1);
    expect(findAll(el, (x) => x.props.htmlFor === "ten").length).toBe(1);
  });
  test("Field không lỗi ⇒ không aria-invalid", () => {
    const el = Field({ id: "a", label: "A", children: <Input /> }) as El;
    const input = findAll(el, (x) => x.props.id === "a" && x.props.htmlFor === undefined)[0] as El;
    expect(input.props["aria-invalid"]).toBeUndefined();
    expect(input.props["aria-describedby"]).toBeUndefined();
  });
});

describe("Badge", () => {
  test("mỗi trạng thái một màu và luôn có icon", () => {
    const st = ["ok", "warn", "bad", "info", "idle"] as const;
    const classes = st.map((status) => cls(Badge({ status, icon: <i />, children: "x" }) as El));
    expect(new Set(classes).size).toBe(5);
    const el = Badge({ status: "ok", icon: <i data-x="1" />, children: "Xong" }) as El;
    expect(findAll(el, (x) => x.props["data-slot"] === "badge-icon").length).toBe(1);
    expect(el.props["data-status"]).toBe("ok");
  });
  test("thiếu icon ⇒ lỗi kiểu", () => {
    // @ts-expect-error icon bắt buộc
    Badge({ status: "ok", children: "x" });
    expect(true).toBe(true);
  });
});

describe("Avatar", () => {
  test("người tròn, công ty vuông bo 28%, cỡ 24/32/40", () => {
    expect(cls(Avatar({ name: "An Bình" }) as El)).toContain("rounded-full");
    expect(cls(Avatar({ name: "ACME", kind: "company" }) as El)).toContain("rounded-[28%]");
    expect(cls(Avatar({ name: "A", size: 24 }) as El)).toContain("size-6");
    expect(cls(Avatar({ name: "A", size: 40 }) as El)).toContain("size-10");
    expect(String((Avatar({ name: "An Bình" }) as El).props["aria-label"])).toBe("An Bình");
  });
  test("AvatarGroup 5 người ⇒ 3 avatar + «+2»", () => {
    const people = ["A", "B", "C", "D", "E"].map((name) => ({ name }));
    const g = AvatarGroup({ people }) as El;
    expect(findAll(g, (x) => x.type === Avatar).length).toBe(3);
    const more = findAll(g, (x) => x.props["data-slot"] === "avatar-more")[0] as El;
    expect(kids(more.props.children).join("")).toBe("+2");
  });
  test("AvatarGroup ≤ 3 người ⇒ không có «+N»", () => {
    const g = AvatarGroup({ people: [{ name: "A" }, { name: "B" }] }) as El;
    expect(findAll(g, (x) => x.props["data-slot"] === "avatar-more").length).toBe(0);
  });
});
