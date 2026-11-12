// CR-120 §one-shell · menu trái + menu tài khoản sinh từ manifest các module, theo quyền gói: đối tác / thành viên / chủ sở hữu.
import { describe, expect, test } from "bun:test";
import { MODULES } from "./modules";
import { activeEntry, buildAccountEntries, buildShellNav, moduleOfPath } from "./nav";

const partner = (p: string) => p === "community";
const member = (p: string) => p === "contracts" || p === "community";
const contractsOnly = (p: string) => p === "contracts";
const nobody = () => false;

const keys = (can: (p: string) => boolean) => buildShellNav(MODULES, can).map((g) => g.key);

describe("buildShellNav", () => {
  test("đối tác (không gói contracts): CHỈ nhóm Community — không có mục Sổ Hợp Tác nào", () => {
    const groups = buildShellNav(MODULES, partner);
    expect(groups.map((g) => g.key)).toEqual(["community"]);
    expect(groups.flatMap((g) => g.items.map((n) => n.to))).toEqual([
      "/community",
      "/community/me",
    ]);
  });

  test("thành viên/chủ sở hữu có cả hai gói: Sổ Hợp Tác trước, Community sau; đủ 6 + 2 mục", () => {
    const groups = buildShellNav(MODULES, member);
    expect(groups.map((g) => g.key)).toEqual(["contracts", "community"]);
    expect(groups[0]?.items.map((n) => n.to)).toEqual([
      "/contracts",
      "/contracts/list",
      "/contracts/requests",
      "/contracts/approvals",
      "/contracts/partners",
      "/contracts/products",
    ]);
    expect(groups[1]?.items.map((n) => n.to)).toEqual(["/community", "/community/me"]);
  });

  test("gói community tắt ⇒ không có nhóm Community; không gói nào ⇒ rỗng", () => {
    expect(keys(contractsOnly)).toEqual(["contracts"]);
    expect(keys(nobody)).toEqual([]);
  });

  test("mọi mục nằm dưới basePath của module sở hữu (không link ngoài / không anchor thô)", () => {
    for (const g of buildShellNav(MODULES, member))
      for (const n of g.items)
        expect(n.to === g.basePath || n.to.startsWith(`${g.basePath}/`)).toBe(true);
  });
});

describe("một khung: mọi mục của mọi module cùng dạng (CR-121 C-5)", () => {
  test("mỗi mục có icon + nhãn i18n `contracts.nav.*` (không mã màu/nhãn cứng); nhóm có nhãn nhóm", () => {
    for (const g of buildShellNav(MODULES, member)) {
      expect(g.labelKey.startsWith("contracts.nav.group.")).toBe(true);
      for (const n of g.items) {
        expect(typeof n.icon === "function" || typeof n.icon === "object").toBe(true);
        expect(n.labelKey.startsWith("contracts.nav.")).toBe(true);
      }
    }
  });
});

describe("buildAccountEntries", () => {
  test("Community đóng góp Tường nhà chỉ khi gói community bật (Cài đặt là MỘT mục chung ở UserMenu)", () => {
    expect(buildAccountEntries(MODULES, partner).map((e) => e.labelKey)).toEqual([
      "contracts.shell.menuProfile",
    ]);
    expect(buildAccountEntries(MODULES, contractsOnly)).toEqual([]);
  });
});

describe("activeEntry / moduleOfPath", () => {
  const groups = buildShellNav(MODULES, member);
  const [contracts, community] = groups;
  test("mục sáng theo đường dẫn; Bảng tin chỉ sáng ở gốc, Hồ sơ của tôi ở /community/me…", () => {
    if (!contracts || !community) throw new Error("thiếu nhóm");
    expect(activeEntry(contracts, "/contracts/c/9")?.to).toBe("/contracts/list");
    expect(activeEntry(community, "/community")?.to).toBe("/community");
    expect(activeEntry(community, "/community/me/org")?.to).toBe("/community/me");
    expect(activeEntry(community, "/contracts/list")).toBeUndefined();
  });
  test("module sở hữu đường dẫn theo basePath, không khớp nửa chữ", () => {
    expect(moduleOfPath(MODULES, "/community/profile")?.key).toBe("community");
    expect(moduleOfPath(MODULES, "/contracts")?.key).toBe("contracts");
    expect(moduleOfPath(MODULES, "/communityX")).toBeUndefined();
  });
});
