// PK-FR-10 · TF5 · luật thuần của Shell: vai theo quyền gói, mục menu đang chọn, giới hạn độ rộng khoang, giao diện.
import { describe, expect, test } from "bun:test";
import { activeNav, canSeeSettings, EXTRA_NAV, MAIN_NAV, NAV, roleOf } from "./nav";
import {
  ASSISTANT_DEFAULT,
  ASSISTANT_MAX,
  ASSISTANT_MIN,
  clampWidth,
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

describe("menu", () => {
  test("6 mục đúng đường dẫn (4 của mgmt-app + Việc của tôi + Mua hàng)", () => {
    expect(NAV.map((n) => n.to)).toEqual([
      "/contracts",
      "/partners",
      "/prices",
      "/cks",
      "/my-work",
      "/sourcing",
    ]);
  });
  test("menu chính/thanh dưới đúng 4 mục mgmt-app; mục thêm tách nhóm riêng", () => {
    expect(MAIN_NAV.map((n) => n.to)).toEqual(["/contracts", "/partners", "/prices", "/cks"]);
    expect(EXTRA_NAV.map((n) => n.to)).toEqual(["/my-work", "/sourcing"]);
  });
  test("mục đang chọn theo tiền tố đường dẫn, không khớp nửa chữ", () => {
    expect(activeNav("/cks/123")?.to).toBe("/cks");
    expect(activeNav("/contracts/new")?.to).toBe("/contracts");
    expect(activeNav("/contractsX")).toBeUndefined();
    expect(activeNav("/settings")).toBeUndefined();
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
