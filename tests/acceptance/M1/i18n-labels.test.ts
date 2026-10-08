// ADM-FR-01, ADM-FR-04, ADM-FR-60 · M1-R22 · chuỗi giao diện song ngữ VI/EN (test-plan C1; plan-frontend §7–§8).
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./_modules";

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}
const load = (lang: string): Record<string, string> =>
  flatten(
    JSON.parse(readFileSync(join(ROOT, `packages/i18n/locales/${lang}.json`), "utf8")) as Tree,
  );

/** [key, VI, EN] nguyên văn từ plan-frontend §7 (mỗi cặp "a / b" tách thành hai key). */
const TABLE: Array<[string, string, string]> = [
  ["auth.login.title", "Đăng nhập", "Sign in"],
  [
    "auth.login.subtitle",
    "Dùng mã công ty và tài khoản do quản trị viên cấp.",
    "Use your company code and the account your administrator gave you.",
  ],
  ["auth.login.field.tenant", "Mã công ty", "Company code"],
  ["auth.login.field.tenantHint", "Được nhớ cho lần đăng nhập sau", "Remembered for next time"],
  ["auth.login.field.username", "Tên đăng nhập", "Username"],
  ["auth.login.field.password", "Mật khẩu", "Password"],
  ["auth.login.submit", "Đăng nhập", "Sign in"],
  ["auth.login.submitting", "Đang đăng nhập…", "Signing in…"],
  [
    "auth.login.forgot",
    "Quên mật khẩu? Liên hệ quản trị viên công ty bạn để được đặt lại.",
    "Forgot your password? Contact your company administrator to reset it.",
  ],
  // [CR-052] hero.* bị thay bằng showcase.* (cột phải login phương án C)
  [
    "auth.login.showcase.title",
    "Công ty, con người và phân quyền. Gói gọn một nơi.",
    "Companies, people and permissions. One place.",
  ],
  [
    "auth.login.showcase.description",
    "Cấp quyền theo nhóm, hạn mức theo công ty, mọi thay đổi đều được ghi nhật ký.",
    "Group-based access, quota per company, every change audited.",
  ],
  ["auth.login.appName", "Evolu Control", "Evolu Control"],
  ["auth.login.footer", "© 2026 EvoluConsulting", "© 2026 EvoluConsulting"],
  ["auth.lang.group", "Ngôn ngữ", "Language"],
  ["auth.lang.vi", "Tiếng Việt", "Tiếng Việt"],
  ["auth.lang.en", "English", "English"],
  [
    "auth.error.invalid",
    "Sai mã công ty, tên đăng nhập hoặc mật khẩu.",
    "Wrong company code, username or password.",
  ],
  ["auth.error.tempLocked", "Tạm khoá đến {time}", "Temporarily locked until {time}"],
  [
    "auth.error.accountLocked",
    "Tài khoản đã bị khoá. Liên hệ quản trị viên công ty bạn.",
    "This account is locked. Contact your company administrator.",
  ],
  [
    "auth.error.network",
    "Không kết nối được máy chủ. Hãy thử lại.",
    "Couldn't reach the server. Please try again.",
  ],
  [
    "auth.error.server",
    "Có lỗi xảy ra, hãy thử lại sau (mã {code}).",
    "Something went wrong, please try again later (code {code}).",
  ],
  ["auth.error.required.tenant", "Nhập mã công ty", "Enter your company code"],
  ["auth.error.required.username", "Nhập tên đăng nhập", "Enter your username"],
  ["auth.error.required.password", "Nhập mật khẩu", "Enter your password"],
  ["password.error.required.current", "Nhập mật khẩu hiện tại", "Enter your current password"],
  ["session.expired.title", "Phiên đăng nhập đã hết hạn", "Your session expired"],
  [
    "session.expired.body",
    "Đăng nhập lại để tiếp tục. Dữ liệu đang nhập được giữ nguyên.",
    "Sign in again to continue. Your unsaved input is kept.",
  ],
  ["member.title", "Tài khoản của bạn dùng Evolu Copilot", "Your account uses Evolu Copilot"],
  [
    "member.body",
    "Trang quản trị chỉ dành cho quản trị viên. Hãy mở Evolu Copilot để làm việc.",
    "Evolu Control is for administrators. Open Evolu Copilot to get started.",
  ],
  ["member.open", "Mở Evolu Copilot", "Open Evolu Copilot"],
  ["nav.main", "Điều hướng chính", "Main navigation"],
  ["nav.overview", "Tổng quan", "Overview"],
  ["nav.group.access", "TRUY CẬP", "ACCESS"],
  ["nav.tenants", "Tenants", "Tenants"],
  ["nav.users", "Users", "Users"],
  ["nav.collapse", "Thu gọn thanh bên", "Collapse sidebar"],
  ["nav.expand", "Mở rộng thanh bên", "Expand sidebar"],
  ["nav.openMenu", "Mở menu", "Open menu"],
  ["nav.skip", "Bỏ qua điều hướng", "Skip to content"],
  ["topbar.platform", "Nền tảng", "Platform"],
  ["account.menu", "Tài khoản của bạn", "Your account"],
  ["account.changePassword", "Đổi mật khẩu", "Change password"],
  ["account.language", "Ngôn ngữ", "Language"],
  // M4 (Q2a, test-plan §5 K11): bỏ overview.welcome/soon/platform.body/tenant.body (Tổng quan thật, plan-frontend §7).
  ["tenants.badge.platform", "Nền tảng", "Platform"],
  [
    "tenants.tab.unavailableBody",
    "Mục này sẽ khả dụng ở bản sau.",
    "This section will be available in a later release.",
  ],
  ["tenants.detail.createdAt", "Tạo lúc {date}", "Created {date}"],
  ["tenants.detail.userCount", "{users} user", "{users} users"],
  ["tenants.toast.saved", "Đã lưu {key}", "Saved {key}"],
  ["tenants.error.nameRequired", "Nhập tên công ty", "Enter the company name"],
  ["users.col.tenant", "Tenant", "Tenant"],
  ["users.filter.role.all", "Tất cả role", "All roles"],
  ["users.status.tempLocked", "Tạm khoá đến {time}", "Temporarily locked until {time}"],
  [
    "users.error.lastPlatformAdmin",
    "Hệ thống phải còn ít nhất một platform_admin đang hoạt động",
    "The system must keep at least one active platform admin",
  ],
  ["users.error.displayNameMax", "Tối đa 64 ký tự", "At most 64 characters"],
  ["users.logoutAll.submit", "Đăng xuất", "Sign out"],
  ["users.drawer.tenantLine", "Tenant: {key}", "Tenant: {key}"],
  [
    "users.drawer.copyAll.text",
    "Mã công ty: {tenant}\nTên đăng nhập: {username}\nMật khẩu tạm: {password}",
    "Company code: {tenant}\nUsername: {username}\nTemporary password: {password}",
  ],
  ["format.lastLogin.now", "Vừa xong", "Just now"],
  ["format.lastLogin.minutes", "{n} phút trước", "{n} min ago"],
  ["format.lastLogin.today", "Hôm nay {time}", "Today {time}"],
  ["format.lastLogin.yesterday", "Hôm qua {time}", "Yesterday {time}"],
  ["common.pagination.range", "{from}–{to} / {total}", "{from}–{to} of {total}"],
  ["common.pagination.prev", "Trước", "Previous"],
  ["common.pagination.next", "Sau", "Next"],
  ["common.pagination.aria", "Phân trang", "Pagination"],
  ["common.loading", "Đang tải", "Loading"],
  ["common.stillLoading", "Vẫn đang tải…", "Still loading…"],
  ["common.saved", "Đã lưu", "Saved"],
  ["common.reload", "Tải lại", "Reload"],
  ["state.error.title", "Không tải được dữ liệu", "Couldn't load data"],
  ["state.error.body", "{message} (mã {code})", "{message} (code {code})"],
  [
    "state.forbidden.title",
    "Bạn không có quyền xem trang này",
    "You don't have access to this page",
  ],
  [
    "state.forbidden.platformOnly",
    "Trang này chỉ dành cho quản trị nền tảng. Nếu cần, hãy liên hệ người quản trị của bạn.",
    "This page is for platform admins only. Contact your administrator if you need access.",
  ],
  ["state.forbidden.cta", "Về Tổng quan", "Back to Overview"],
  [
    "state.forbiddenAction",
    "Bạn không còn quyền thực hiện thao tác này",
    "You no longer have permission to do this",
  ],
  ["state.notFound.title", "Không tìm thấy", "Not found"],
  [
    "state.notFound.body",
    "Mục này không tồn tại hoặc đã bị xoá.",
    "This item doesn't exist or was deleted.",
  ],
  ["state.notFound.cta", "Về danh sách", "Back to list"],
  ["state.empty.noResults", "Không có kết quả cho '{q}'", "No results for '{q}'"],
  ["state.empty.noMatch", "Không có mục nào khớp bộ lọc", "Nothing matches these filters"],
  [
    "state.offline.banner",
    "Mất kết nối, thay đổi chưa được lưu",
    "Connection lost — changes aren't saved",
  ],
  ["state.offline.saveTip", "Đang chờ kết nối lại", "Waiting for connection"],
  ["state.online", "Đã kết nối lại", "Back online"],
  ["unsaved.title", "Bỏ thay đổi?", "Discard changes?"],
  ["unsaved.body", "Các thay đổi chưa lưu sẽ mất.", "Unsaved changes will be lost."],
  ["unsaved.stay", "Ở lại", "Stay"],
  ["unsaved.discard", "Bỏ thay đổi", "Discard"],
  [
    "errors.selfAction",
    "Bạn không thể tự khoá hoặc hạ role của chính mình.",
    "You can't lock or demote yourself.",
  ],
  [
    "errors.platformTenantLocked",
    "Không thể khoá tenant nền tảng.",
    "The platform tenant can't be locked.",
  ],
  [
    "errors.versionConflict",
    "Có người vừa lưu bản mới hơn. Tải lại để xem bản mới nhất.",
    "Someone just saved a newer version. Reload to see the latest.",
  ],
];

/** Nhãn e2e (plan-frontend §8, test-plan C1) phải là giá trị đầy đủ của một key trong vi.json. */
const E2E_LABELS = [
  "Mã công ty",
  "Tên đăng nhập",
  "Đăng nhập",
  "Đặt mật khẩu và tiếp tục",
  "Tạo tenant",
  "Thao tác khác",
  "Khoá tenant",
  "Mở khoá tenant",
  "Reset mật khẩu",
  "Đăng xuất mọi thiết bị",
  "Sao chép tất cả",
  "Tài khoản của bạn",
  "Điều hướng chính",
  "Tổng quan",
  "Phiên đăng nhập đã hết hạn",
  "Bạn không có quyền xem trang này",
  "Không tìm thấy",
  "Tài khoản của bạn dùng Evolu Copilot",
];

describe("ADM-FR-01 · M1-R22 · i18n VI/EN", () => {
  it("ADM-FR-01 · M1-R22 · vi.json và en.json có cùng tập key", () => {
    const vi = Object.keys(load("vi")).sort();
    const en = Object.keys(load("en")).sort();
    expect(en).toEqual(vi);
  });

  it("ADM-FR-01 · M1-R22 · mọi key trong plan-frontend §7 có giá trị VI và EN nguyên văn", () => {
    const vi = load("vi");
    const en = load("en");
    const wrong: string[] = [];
    for (const [key, viText, enText] of TABLE) {
      if (vi[key] !== viText) wrong.push(`vi.${key}`);
      if (en[key] !== enText) wrong.push(`en.${key}`);
    }
    expect(wrong).toEqual([]);
  });

  it("ADM-FR-01 · M1-R22 · nhãn e2e (plan-frontend §8) xuất hiện làm giá trị đầy đủ trong vi.json", () => {
    const values = new Set(Object.values(load("vi")));
    const missing = E2E_LABELS.filter((l) => !values.has(l));
    expect(missing).toEqual([]);
  });

  it("ADM-FR-01 · M1-R22 · bun run i18n:check exit 0", () => {
    const p = Bun.spawnSync(["bun", "tools/scripts/src/i18n-check.ts"], { cwd: ROOT });
    expect(p.exitCode).toBe(0);
  });
});
