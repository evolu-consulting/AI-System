// ADM-FR-36 · M3-R24 · Phân quyền, Kiểm tra quyền, Users/Commands (cột Groups, Số user thấy) · chuỗi giao diện song ngữ VI/EN của M3 (test-plan C1; plan-frontend §5, §7). Không DB.
// Bảng cố định từ plan-frontend §7 (nhóm theo tiền tố key); xanh ở FE4c. `bun run i18n:check` chạy riêng ở lệnh xong.
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

type Row = [string, string, string];
const TABLE: Row[] = [
  ["nav.access", "Phân quyền", "Access"],
  ["access.title", "Phân quyền", "Access"],
  [
    "access.subtitle",
    "Cấp feature cho từng group. Chỉ cấp được feature mà công ty đã được nền tảng mở.",
    "Grant features to groups. You can only grant features the platform has opened for the company.",
  ],
  ["access.tab.matrix", "Ma trận", "Matrix"],
  ["access.tab.check", "Kiểm tra quyền", "Access check"],
  [
    "access.selectTenant",
    "Chọn một tenant để phân quyền cho tenant đó.",
    "Choose a tenant to manage its access.",
  ],
  ["access.matrix.title", "Ma trận feature × group", "Feature × group matrix"],
  ["access.matrix.aria", "Ma trận feature × group", "Feature × group matrix"],
  ["access.matrix.dirty_one", "{count} thay đổi chưa lưu", "{count} unsaved change"],
  ["access.matrix.dirty_other", "{count} thay đổi chưa lưu", "{count} unsaved changes"],
  [
    "access.matrix.tooMany",
    "Tối đa 200 thay đổi mỗi lần lưu (đang có {count}). Lưu bớt rồi làm tiếp.",
    "At most 200 changes per save ({count} now). Save some, then continue.",
  ],
  ["access.matrix.cell", "{feature} cho group {group}", "{feature} for group {group}"],
  ["access.matrix.rowAll", "Cấp {feature} cho mọi group", "Grant {feature} to every group"],
  [
    "access.matrix.colAll",
    "Cấp mọi feature cho group {group}",
    "Grant every feature to group {group}",
  ],
  ["access.matrix.tip.on", "Đã cấp", "Granted"],
  ["access.matrix.tip.off", "Chưa cấp", "Not granted"],
  [
    "access.matrix.tip.notOpened",
    "Công ty chưa được mở feature này",
    "The company hasn't been given this feature",
  ],
  ["access.matrix.tip.core", "Mọi người đều có", "Everyone has it"],
  ["access.matrix.badge.default", "Mặc định", "Default"],
  ["access.matrix.badge.unsaved", "Chưa lưu", "Unsaved"],
  ["access.matrix.badge.beta", "Beta", "Beta"],
  ["access.matrix.badge.notOpened", "Chưa mở", "Not opened"],
  ["access.matrix.revoked", "Đã thu hồi entitlement", "Entitlement revoked"],
  [
    "access.matrix.showUnopened",
    "Hiện feature chưa mở ({count})",
    "Show unopened features ({count})",
  ],
  [
    "access.matrix.noGroups",
    "Chưa có group nào. Tạo group trước, rồi quay lại cấp feature.",
    "No groups yet. Create a group first, then come back to grant features.",
  ],
  ["access.matrix.noGroupsCta", "Tạo group", "Create group"],
  [
    "access.matrix.unopenedHint",
    "Liên hệ nền tảng để mở feature này cho công ty.",
    "Contact the platform to open this feature for the company.",
  ],
  [
    "access.toast.saved",
    "Đã lưu quyền · {added} cấp, {removed} thu. Thành viên thấy thay đổi trong vài giây.",
    "Saved · {added} granted, {removed} revoked. Members see the change within seconds.",
  ],
  [
    "access.toast.grantedToGroup",
    "Đã cấp {feature} cho group {group}",
    "Granted {feature} to group {group}",
  ],
  [
    "access.error.notEntitled",
    "Công ty chưa được mở feature này nên không cấp được. Đã tải lại ma trận.",
    "The company hasn't been given this feature, so it can't be granted. The matrix was reloaded.",
  ],
  [
    "access.error.coreProtected",
    "core có sẵn cho mọi người, không cần cấp.",
    "core is available to everyone and needs no grant.",
  ],
  [
    "access.error.batchFail",
    "Không lưu được, chưa có thay đổi nào được áp dụng.",
    "Couldn't save; none of the changes were applied.",
  ],
  ["access.check.title", "Kiểm tra quyền", "Access check"],
  [
    "access.check.subtitle",
    'Trả lời "sao tôi không thấy lệnh X"',
    'Answers "why can\'t I see command X"',
  ],
  ["access.check.user", "Người dùng", "User"],
  ["access.check.userPlaceholder", "Nhập username…", "Enter a username…"],
  [
    "access.check.prompt",
    "Chọn một người dùng để xem họ dùng được gì và vì sao.",
    "Choose a user to see what they can use, and why.",
  ],
  [
    "access.check.userNotFound",
    "Không tìm thấy người dùng này trong tenant.",
    "This user isn't in the tenant.",
  ],
  ["access.check.search", "Tìm command", "Search commands"],
  ["access.check.searchPlaceholder", "Tìm command, ví dụ kiemtra", "Search commands, e.g. kiemtra"],
  ["access.check.section.features", "Feature", "Features"],
  ["access.check.section.commands", "Command", "Commands"],
  ["access.check.section.agents", "Agent", "Agents"],
  ["access.check.summary", "Thấy {visible}/{total} command", "Sees {visible} of {total} commands"],
  ["access.check.sees", "Thấy {name}", "Can see {name}"],
  ["access.check.notSees", "Không thấy {name}", "Can't see {name}"],
  [
    "access.check.showHidden",
    "Hiện command không thấy ({count})",
    "Show hidden commands ({count})",
  ],
  ["access.check.hideHidden", "Ẩn command không thấy", "Hide hidden commands"],
  [
    "access.check.showUnusable",
    "Hiện feature không dùng được ({count})",
    "Show unavailable features ({count})",
  ],
  ["access.check.why", "Vì sao không?", "Why not?"],
  ["access.check.hideWhy", "Ẩn lý do", "Hide reason"],
  ["access.check.more", "Còn {count} mục, gõ để lọc", "{count} more, type to filter"],
  ["access.check.grantTo", "Cấp {feature} cho group…", "Grant {feature} to a group…"],
  ["access.check.addBeta", "Thêm {user} vào beta-testers", "Add {user} to beta-testers"],
  ["access.check.openFeature", "Mở feature {feature}", "Open feature {feature}"],
  ["access.grant.title", "Cấp {feature} cho group", "Grant {feature} to group"],
  ["access.grant.group", "Group", "Group"],
  ["access.grant.groupRequired", "Chọn một group", "Choose a group"],
  [
    "access.grant.hint",
    "Thành viên của group thấy các command của feature này trong vài giây.",
    "Members of the group see this feature's commands within seconds.",
  ],
  ["access.grant.submit", "Cấp", "Grant"],
  ["access.reason.grantGroup", "qua group {group}", "via group {group}"],
  ["access.reason.grantUser", "được cấp trực tiếp cho người này", "granted directly to this user"],
  ["access.reason.betaMember", "qua group beta-testers", "via the beta-testers group"],
  [
    "access.reason.viaFeatureGroup",
    "qua feature {feature} · group {group}",
    "via feature {feature} · group {group}",
  ],
  ["access.reason.viaFeature", "qua feature {feature}", "via feature {feature}"],
  ["access.reason.featureOff", "Feature {feature} đang tắt.", "Feature {feature} is off."],
  [
    "access.reason.betaNotMember",
    "Feature {feature} đang ở Beta và {user} chưa thuộc group beta-testers.",
    "Feature {feature} is in Beta and {user} isn't in the beta-testers group.",
  ],
  [
    "access.reason.noEntitlement",
    "Feature {feature} chưa được mở cho công ty. Liên hệ nền tảng để mở.",
    "Feature {feature} hasn't been opened for the company. Contact the platform to open it.",
  ],
  [
    "access.reason.noGrant",
    "Feature {feature} chưa cấp cho {user} hay group nào của {user}.",
    "Feature {feature} isn't granted to {user} or any of their groups.",
  ],
  [
    "access.reason.noEffectiveFeature",
    "Command chưa thuộc feature nào dùng được.",
    "The command isn't in any available feature.",
  ],
  [
    "access.matrix.groupsTrimmed",
    "Đang hiện {shown}/{total} group. Gõ để lọc.",
    "Showing {shown} of {total} groups. Type to filter.",
  ],
  ["access.matrix.filterGroups", "Lọc group", "Filter groups"],
  ["access.reason.commandDisabled", "Command đang tắt.", "The command is disabled."],
  [
    "access.reason.workflowDisabled",
    "Workflow của command đang tắt.",
    "The command's workflow is disabled.",
  ],
  ["access.reason.userInactive", "Tài khoản này đang bị khoá.", "This account is locked."],
  ["access.reason.tenantLocked", "Công ty đang bị khoá.", "The company is locked."],
  ["access.reason.unknown", "Không rõ lý do.", "Reason unknown."],
  ["users.col.groups", "Groups", "Groups"],
  ["users.col.filter.group", "Group", "Group"],
  ["users.col.filter.allGroups", "Tất cả group", "All groups"],
  ["users.filter.groupChip", "Group: {key}", "Group: {key}"],
  ["users.filter.groupNeedsTenant", "Chọn tenant trước", "Choose a tenant first"],
  ["users.groups.more", "Còn: {names}", "Also: {names}"],
  [
    "users.field.groupsReadonly",
    "Sửa thành viên ở trang Group.",
    "Edit membership on the Group page.",
  ],
  ["users.field.groupsNone", "Chưa thuộc group nào", "Not in any group"],
  ["users.access.summary", "Thấy {visible}/{total} command", "Sees {visible} of {total} commands"],
  ["commands.access.col.groups", "Group được cấp", "Granted groups"],
  ["commands.access.col.visible", "Số user thấy", "Users who see it"],
  ["commands.access.groups.none", "Chưa group nào được cấp", "No group granted yet"],
  ["commands.access.groups.more", "+{count} group nữa", "+{count} more groups"],
  [
    "commands.access.visibleHint",
    "Đã tính feature, group và Beta. Công ty có {active} user đang hoạt động.",
    "Counts feature, group and Beta rules. The company has {active} active users.",
  ],
];

/** Nhãn e2e (plan-frontend §5) phải là giá trị ĐẦY ĐỦ của một key trong vi.json (khớp từng ký tự). */
const E2E_LABELS = [
  "Phân quyền",
  "Ma trận",
  "Kiểm tra quyền",
  "Ma trận feature × group",
  "Đã thu hồi entitlement",
  "Mặc định",
  "Hiện feature chưa mở ({count})",
  "Vì sao không?",
  "Người dùng",
  "Tìm command",
  "Cấp",
  "Group",
  "Group được cấp",
  "Số user thấy",
  "Tất cả group",
  "Groups",
  "Quyền hiệu lực",
  "Mở Kiểm tra quyền",
  "Chọn một tenant để phân quyền cho tenant đó.",
  "Chưa group nào được cấp",
];

describe("ADM-FR-36 · M3-R24 · i18n VI/EN (access)", () => {
  it("ADM-FR-36 · M3-R24 · vi.json và en.json có cùng tập key", () => {
    const vi = Object.keys(load("vi")).sort();
    const en = Object.keys(load("en")).sort();
    expect(en).toEqual(vi);
  });

  it("ADM-FR-36 · M3-R24 · mọi key nhóm access (plan-frontend §7) có giá trị VI và EN nguyên văn", () => {
    const vi = load("vi");
    const en = load("en");
    const wrong: string[] = [];
    for (const [key, viText, enText] of TABLE) {
      if (vi[key] !== viText) wrong.push(`vi.${key}`);
      if (en[key] !== enText) wrong.push(`en.${key}`);
    }
    expect(wrong).toEqual([]);
  });

  it("ADM-FR-36 · M3-R24 · nhãn e2e nhóm access xuất hiện làm giá trị đầy đủ trong vi.json", () => {
    const set = new Set(Object.values(load("vi")));
    expect(E2E_LABELS.filter((l) => !set.has(l))).toEqual([]);
  });

  it("ADM-FR-24 · M3-R14 · key commands.access.groupsLater (card 'chưa khả dụng' của M2) đã bị gỡ khỏi cả hai locale", () => {
    expect("commands.access.groupsLater" in load("vi")).toBe(false);
    expect("commands.access.groupsLater" in load("en")).toBe(false);
  });
});
