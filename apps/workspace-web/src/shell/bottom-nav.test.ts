// CR-125 · cr125-fix-bottomnav · thanh dưới 375 px: Bảng tin + Hợp đồng luôn có mặt, «Tạo yêu cầu» không chiếm cột.
import { describe, expect, test } from "bun:test";
import { pickBottomItems } from "./bottom-nav";
import { MODULES } from "./modules";
import { buildShellNav } from "./nav";

const member = (p: string) => p === "contracts" || p === "community";
const all = buildShellNav(MODULES, member).flatMap((g) => g.items);

describe("pickBottomItems", () => {
  test("có gói Sổ Hợp Tác: 4 mục gồm Hợp đồng + Bảng tin, không có Tạo yêu cầu", () => {
    const to = pickBottomItems(
      all.filter((n) => !n.to.endsWith("/products")),
      4,
    ).map((n) => n.to);
    expect(to).toHaveLength(4);
    expect(to).toContain("/community");
    expect(to).toContain("/contracts/list");
    expect(to).not.toContain("/contracts/requests");
  });

  test("mục `more` và `bottom:false` bị loại; primary đứng trước", () => {
    const icon = all[0]?.icon;
    if (!icon) throw new Error("thiếu icon");
    const mk = (to: string, x: object = {}) => ({ to, labelKey: to, icon, ...x });
    const to = pickBottomItems(
      [
        mk("/a"),
        mk("/b", { mobile: "more" }),
        mk("/c", { bottom: false }),
        mk("/d", { mobile: "primary" }),
      ],
      5,
    ).map((n) => n.to);
    expect(to).toEqual(["/d", "/a"]);
  });
});
