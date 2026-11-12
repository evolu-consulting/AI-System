// CR-118 · cr118-app-config · luật thuần xem trước theo vai (previewApp): mức công ty, tính năng thêm, vai thành viên, đối tác, khe quy trình.
import { describe, expect, test } from "bun:test";
import {
  COMMUNITY_MANIFEST,
  CONTRACTS_MANIFEST,
  getAppManifest,
  levelOf,
  previewApp,
} from "./index";

const set = (...k: string[]) => new Set(k);
const navOf = (r: ReturnType<typeof previewApp>["member"]) =>
  Object.fromEntries(r.nav.map((n) => [n.key, n]));

describe("previewApp · Community", () => {
  test("mức Xem: thành viên thấy Bảng tin + Bài của tôi, không thấy Duyệt bài, không có hành động Đăng bài", () => {
    const p = previewApp(COMMUNITY_MANIFEST, set("community-read"), [], []);
    expect(p.member.level).toBe("read");
    expect(p.member.appVisible).toBe(true);
    const nav = navOf(p.member);
    expect(nav.feed?.visible).toBe(true);
    expect(nav.myPosts?.visible).toBe(true);
    expect(nav.moderate?.reason).toEqual({ code: "company_admin_only" });
    const post = nav.feed?.actions.find((a) => a.key === "post");
    expect(post?.visible).toBe(false);
    expect(post?.reason).toEqual({ code: "need_level", level: "write" });
  });

  test("app Tắt: không vai nào thấy nhóm app, lý do app_off", () => {
    const p = previewApp(COMMUNITY_MANIFEST, set(), [], []);
    for (const r of ["company_admin", "member", "partner"] as const) {
      expect(p[r].level).toBe("off");
      expect(p[r].appVisible).toBe(false);
    }
    expect(navOf(p.company_admin).feed?.reason).toEqual({ code: "app_off" });
  });

  test("đối tác thấy Bảng tin khi công ty bật app, nhưng không bao giờ thấy mục chỉ quản trị", () => {
    const p = previewApp(COMMUNITY_MANIFEST, set("community-read", "community-write"), [], []);
    expect(p.partner.appVisible).toBe(true);
    expect(navOf(p.partner).feed?.visible).toBe(true);
    expect(navOf(p.partner).moderate?.reason).toEqual({ code: "partner_never" });
    expect(navOf(p.partner).feed?.actions.find((a) => a.key === "post")?.visible).toBe(true);
  });

  test("quản trị công ty thấy Duyệt bài chỉ khi có mức Quản trị", () => {
    const w = previewApp(COMMUNITY_MANIFEST, set("community-read", "community-write"), [], []);
    expect(navOf(w.company_admin).moderate?.reason).toEqual({ code: "need_level", level: "admin" });
    const a = previewApp(
      COMMUNITY_MANIFEST,
      set("community-read", "community-write", "community-admin"),
      [],
      [],
    );
    expect(navOf(a.company_admin).moderate?.visible).toBe(true);
  });
});

describe("previewApp · Sổ Hợp Tác", () => {
  const sht = (...k: string[]) => set("contracts-read", ...k);

  test("đối tác không bao giờ thấy nhóm Sổ Hợp Tác (dù công ty bật Quản trị)", () => {
    const p = previewApp(CONTRACTS_MANIFEST, sht("contracts-write", "contracts-admin"), [], []);
    expect(p.partner.appVisible).toBe(false);
    expect(p.partner.nav.every((n) => n.reason?.code === "partner_never")).toBe(true);
    expect(p.partner.slots).toEqual([]);
  });

  test("hành động cần tính năng thêm: thiếu ⇒ ẩn, nêu tên dễ hiểu (khung add-on còn dùng cho app khác)", () => {
    const gated = {
      ...CONTRACTS_MANIFEST,
      nav: CONTRACTS_MANIFEST.nav.map((n) =>
        n.key === "contracts"
          ? {
              ...n,
              actions: n.actions?.map((a) =>
                a.key === "approve-flow" ? { ...a, addon: "han-muc-duyet" } : a,
              ),
            }
          : n,
      ),
    };
    const p = previewApp(gated, sht("contracts-write"), [], []);
    const act = navOf(p.member).contracts?.actions.find((a) => a.key === "approve-flow");
    expect(act?.visible).toBe(false);
    expect(act?.reason).toEqual({
      code: "need_addon",
      addon: "han-muc-duyet",
      label: "Kiểm tra hạn mức duyệt",
    });
  });

  test("CR-121 D-4 · duyệt theo quy trình KHÔNG cần tính năng thêm: đủ mức Sửa là hiện, khe chạy kèm quy trình đang gán (CR-127 Z3c: khe Tiếp nhận)", () => {
    const assign = [
      { slot: "contracts.intake", def_name: "Duyệt 3 phòng", rel_version: 2, is_default: false },
    ];
    const p = previewApp(CONTRACTS_MANIFEST, sht("contracts-write"), [], assign);
    const act = navOf(p.member).contracts?.actions.find((a) => a.key === "approve-flow");
    expect(act?.visible).toBe(true);
    expect(p.company_admin.slots[0]).toMatchObject({
      running: true,
      process: { name: "Duyệt 3 phòng", version: 2, isDefault: false },
    });
  });
  test("thành viên: công ty đã có vai nhưng không vai nào đủ mức Sửa ⇒ ẩn mục Cài đặt/hành động ghi (no_role)", () => {
    const roles = [{ pack: "contracts", level: "read" as const }];
    const p = previewApp(CONTRACTS_MANIFEST, sht("contracts-write"), roles, []);
    const create = navOf(p.member).contracts?.actions.find((a) => a.key === "create");
    expect(create?.reason).toEqual({ code: "no_role", level: "write" });
    // quản trị công ty không bị ràng buộc vai
    expect(navOf(p.company_admin).contracts?.actions.find((a) => a.key === "create")?.visible).toBe(
      true,
    );
  });

  test("chưa có vai nào ⇒ thành viên theo mức của công ty", () => {
    const p = previewApp(CONTRACTS_MANIFEST, sht("contracts-write"), [], []);
    expect(navOf(p.member).contracts?.actions.find((a) => a.key === "create")?.visible).toBe(true);
  });
});

describe("levelOf / getAppManifest", () => {
  test("mức cao nhất đang có; app lạ không có manifest", () => {
    expect(levelOf(CONTRACTS_MANIFEST, set())).toBe("off");
    expect(levelOf(CONTRACTS_MANIFEST, set("contracts-read", "contracts-admin"))).toBe("admin");
    expect(getAppManifest("studio")).toBeUndefined();
    expect(getAppManifest("community")).toBe(COMMUNITY_MANIFEST);
  });
});
