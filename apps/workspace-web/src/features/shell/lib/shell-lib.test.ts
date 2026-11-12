// PK-FR-10 · TF5 · luật thuần của Shell: vai theo quyền gói, mục menu đang chọn, giới hạn độ rộng khoang, giao diện.
import { describe, expect, test } from "bun:test";
import { activeNav, canSeeSettings, fabHiddenOn, layoutOf, NAV, roleOf } from "./nav";
import {
  ASSISTANT_DEFAULT,
  ASSISTANT_MAX,
  ASSISTANT_MIN,
  clampWidth,
  NAV_PINNED_KEY,
  readBool,
  readWidth,
} from "./stored";
import { applyTheme } from "./theme";

describe("vai theo quyền gói", () => {
  test("owner > editor > viewer; viewer không thấy Cài đặt", () => {
    expect(roleOf({ write: true, owner: true })).toBe("owner");
    expect(roleOf({ write: true, owner: false })).toBe("editor");
    expect(roleOf({ write: false, owner: false })).toBe("viewer");
    expect(canSeeSettings("viewer")).toBe(false);
    expect(canSeeSettings("editor")).toBe(true);
    expect(canSeeSettings("owner")).toBe(true);
    expect(canSeeSettings("viewer", "tenant_admin")).toBe(true);
    expect(canSeeSettings("viewer", "member")).toBe(false);
  });
});

describe("menu (nav-v2)", () => {
  test("đúng 4 mục, đúng thứ tự: Tổng quan · Hợp đồng & giao dịch · Đối tác · Sản phẩm & Giá", () => {
    expect(NAV.map((n) => n.to)).toEqual([
      "/contracts",
      "/contracts/list",
      "/contracts/partners",
      "/contracts/products",
    ]);
    expect(NAV.map((n) => n.labelKey)).toEqual([
      "contracts.nav.overview",
      "contracts.nav.contracts",
      "contracts.nav.partners",
      "contracts.nav.products",
    ]);
  });
  test("mục đang chọn theo tiền tố đường dẫn, không khớp nửa chữ", () => {
    expect(activeNav("/contracts/c/new")?.to).toBe("/contracts/list");
    expect(activeNav("/contracts/products")?.to).toBe("/contracts/products");
    expect(activeNav("/contractsX")).toBeUndefined();
    expect(activeNav("/contracts/settings")).toBeUndefined();
  });
  test("Tổng quan chỉ sáng ở gốc /contracts; chi tiết /contracts/c/<id> thuộc mục Hợp đồng", () => {
    expect(activeNav("/contracts")?.to).toBe("/contracts");
    expect(activeNav("/contracts/c/abc")?.to).toBe("/contracts/list");
    expect(activeNav("/contracts/list")?.to).toBe("/contracts/list");
    expect(activeNav("/contracts/partners")?.to).toBe("/contracts/partners");
    expect(activeNav("/contracts/notifications")).toBeUndefined();
  });
  test("bố cục: Tổng quan rộng; danh sách đầy cột; còn lại đọc", () => {
    expect(layoutOf("/contracts")).toBe("wide");
    expect(layoutOf("/contracts/list")).toBe("board");
    expect(layoutOf("/contracts/partners")).toBe("board");
    expect(layoutOf("/contracts/products")).toBe("board");
    expect(layoutOf("/contracts/c/new")).toBe("reading");
    expect(layoutOf("/community")).toBe("wide"); // CR-120: Community trong cùng khung
    expect(layoutOf("/community/profile")).toBe("wide");
  });
});

describe("độ rộng khoang phải", () => {
  test("kẹp 280–560; giá trị hỏng về mặc định", () => {
    expect(clampWidth(100)).toBe(ASSISTANT_MIN);
    expect(clampWidth(900)).toBe(ASSISTANT_MAX);
    expect(clampWidth(400)).toBe(400);
    expect(clampWidth(Number.NaN)).toBe(ASSISTANT_DEFAULT);
  });
  test("storage không có / bị chặn ⇒ mặc định", () => {
    expect(readBool("assistant:open", false)).toBe(false);
    expect(readWidth("assistant:width")).toBe(ASSISTANT_DEFAULT);
    expect(readBool(NAV_PINNED_KEY, true)).toBe(true);
  });
});

describe("theme", () => {
  test("light/dark đặt data-theme; auto gỡ thuộc tính", () => {
    const root = { dataset: {} as Record<string, string | undefined> } as unknown as HTMLElement;
    applyTheme("dark", root);
    expect(root.dataset.theme).toBe("dark");
    applyTheme("light", root);
    expect(root.dataset.theme).toBe("light");
    applyTheme("auto", root);
    expect(root.dataset.theme).toBeUndefined();
  });
});

describe("fabHiddenOn · nút nổi trợ lý không che nút Gửi của Tin nhắn", () => {
  test("ẩn ở /contracts/messages (+ con); hiện ở trang khác", () => {
    expect(fabHiddenOn("/contracts/messages")).toBe(true);
    expect(fabHiddenOn("/contracts/messages/abc")).toBe(true);
    expect(fabHiddenOn("/contracts")).toBe(false);
    expect(fabHiddenOn("/contracts/list")).toBe(false);
  });
});

describe("nhãn ngắn thanh dưới", () => {
  test("«Hợp đồng & giao dịch» có nhãn ngắn riêng cho thanh dưới điện thoại", () => {
    expect(NAV.find((n) => n.to.endsWith("/list"))?.shortLabelKey).toBe(
      "contracts.nav.contractsShort",
    );
  });
});
