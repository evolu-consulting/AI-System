// ADM-FR-62 · M3-R24 · Groups, menu Groups · chuỗi giao diện song ngữ VI/EN của M3 (test-plan C1; plan-frontend §5, §7). Không DB.
// Bảng cố định từ plan-frontend §7 (nhóm theo tiền tố key); xanh ở FE2d. `bun run i18n:check` chạy riêng ở lệnh xong.
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
  ["nav.groups", "Groups", "Groups"],
  ["groups.list.title", "Groups", "Groups"],
  [
    "groups.list.subtitle",
    "Nhóm người dùng của {tenant}. Cấp feature cho cả nhóm thay vì từng người.",
    "Groups of {tenant}. Grant features to a whole group instead of person by person.",
  ],
  ["groups.list.create", "+ Tạo group", "+ New group"],
  ["groups.list.search", "Tìm theo tên, key…", "Search by name, key…"],
  ["groups.col.group", "Group", "Group"],
  ["groups.col.members", "Thành viên", "Members"],
  ["groups.col.features", "Feature", "Features"],
  ["groups.col.agents", "Agent", "Agents"],
  ["groups.badge.builtin", "Có sẵn", "Built-in"],
  ["groups.beta.hint", "Thấy các feature đang Beta", "Sees features in Beta"],
  ["groups.menu.edit", "Sửa", "Edit"],
  ["groups.menu.delete", "Xoá", "Delete"],
  [
    "groups.protected.tip",
    "Group beta-testers có sẵn, không xoá được",
    "The built-in beta-testers group can't be deleted",
  ],
  [
    "groups.selectTenant",
    "Chọn một tenant để xem group của tenant đó.",
    "Choose a tenant to see its groups.",
  ],
  [
    "groups.empty.text",
    "Chưa có group nào. Tạo group để cấp feature cho cả phòng ban.",
    "No groups yet. Create a group to grant features to a whole team.",
  ],
  ["groups.empty.cta", "+ Tạo group đầu tiên", "+ Create your first group"],
  ["groups.editor.titleNew", "Group mới", "New group"],
  ["groups.editor.breadcrumb.new", "Group mới", "New group"],
  [
    "groups.summary",
    "{members} thành viên · {features} feature",
    "{members} members · {features} features",
  ],
  ["groups.field.key", "Key", "Key"],
  ["groups.field.name", "Tên", "Name"],
  ["groups.field.description", "Mô tả", "Description"],
  [
    "groups.field.keyLocked",
    "Key không đổi được sau khi tạo",
    "Key can't be changed after creation",
  ],
  ["groups.field.descCount", "{n}/400", "{n}/400"],
  ["groups.create.submit", "Tạo group", "Create group"],
  ["groups.rename.button", "Đổi tên", "Rename"],
  ["groups.rename.title", "Đổi tên group", "Rename group"],
  ["groups.tab.members", "Thành viên", "Members"],
  ["groups.tab.features", "Feature", "Features"],
  ["groups.tab.agents", "Agent", "Agents"],
  ["groups.members.add", "Thêm người", "Add people"],
  ["groups.members.addPlaceholder", "Tìm người dùng…", "Search users…"],
  ["groups.members.col.user", "Người dùng", "User"],
  ["groups.members.col.other", "Group khác", "Other groups"],
  ["groups.members.col.lastLogin", "Lần đăng nhập cuối", "Last sign-in"],
  ["groups.members.remove.aria", "Bỏ {username} khỏi group", "Remove {username} from group"],
  ["groups.members.empty", "Group này chưa có thành viên.", "This group has no members yet."],
  [
    "groups.paste.label",
    "Thêm nhiều người: dán username, mỗi dòng một người",
    "Add many: paste usernames, one per line",
  ],
  ["groups.paste.aria", "Dán danh sách username", "Paste a list of usernames"],
  ["groups.paste.count_one", "{count} username", "{count} username"],
  ["groups.paste.count_other", "{count} username", "{count} usernames"],
  ["groups.paste.submit_one", "Thêm {count} người", "Add {count} person"],
  ["groups.paste.submit_other", "Thêm {count} người", "Add {count} people"],
  ["groups.paste.notFound", "Không tìm thấy: {names}", "Not found: {names}"],
  ["groups.paste.already_one", "{count} người đã ở trong group", "{count} already in the group"],
  ["groups.paste.already_other", "{count} người đã ở trong group", "{count} already in the group"],
  [
    "groups.paste.tooMany",
    "Tối đa 500 username mỗi lần. Bạn đã dán {count}.",
    "At most 500 usernames at a time. You pasted {count}.",
  ],
  ["groups.paste.checking", "Đang kiểm tra…", "Checking…"],
  ["groups.features.title", "Feature được cấp", "Granted features"],
  [
    "groups.features.hint",
    "Chỉ chọn được feature mà công ty đã được cấp.",
    "You can only pick features the company has been granted.",
  ],
  ["groups.features.edit", "Sửa", "Edit"],
  ["groups.features.core", "Mọi người đều có", "Everyone has it"],
  [
    "groups.features.empty",
    "Group chưa được cấp feature nào ngoài core.",
    "This group has no features beyond core.",
  ],
  [
    "groups.agents.body",
    "Cấp agent cho group làm ở Agent Studio, khi Agent Hub sẵn sàng.",
    "Granting agents to a group is done in Agent Studio once Agent Hub is ready.",
  ],
  ["groups.delete.title", "Xoá {name}?", "Delete {name}?"],
  [
    "groups.delete.body",
    "{members} thành viên sẽ rời group và {features} feature đang cấp cho group sẽ bị thu hồi. Tài khoản người dùng vẫn giữ nguyên.",
    "{members} members will leave the group and {features} granted features will be revoked from it. User accounts stay as they are.",
  ],
  ["groups.delete.typeToConfirm", "Gõ {key} để xác nhận", "Type {key} to confirm"],
  ["groups.delete.submit", "Xoá group", "Delete group"],
  ["groups.toast.created", "Đã tạo {name}", "Created {name}"],
  ["groups.toast.saved", "Đã lưu {name}", "Saved {name}"],
  ["groups.toast.deleted", "Đã xoá {name}", "Deleted {name}"],
  ["groups.toast.memberAdded", "Đã thêm {username} vào {group}", "Added {username} to {group}"],
  [
    "groups.toast.memberRemoved",
    "Đã bỏ {username} khỏi {group}",
    "Removed {username} from {group}",
  ],
  ["groups.toast.pasted", "Đã thêm {count} người vào {group}", "Added {count} people to {group}"],
  [
    "groups.toast.pastedPartial",
    "Đã thêm {added} người, {missing} username không tìm thấy",
    "Added {added}, {missing} usernames not found",
  ],
  [
    "groups.toast.featuresSaved",
    "Đã lưu feature của {group}. Thành viên thấy thay đổi trong vài giây.",
    "Saved features of {group}. Members see the change within seconds.",
  ],
  [
    "groups.error.keyFormat",
    "Chỉ dùng chữ thường không dấu, số, dấu - (2–32 ký tự)",
    "Use lowercase letters, digits and - only (2–32 chars)",
  ],
  [
    "groups.error.keyTaken",
    "Key đã được dùng trong tenant này",
    "Key is already used in this tenant",
  ],
  [
    "groups.error.nameRequired",
    "Nhập tên group (tối đa 64 ký tự)",
    "Enter a group name (at most 64 characters)",
  ],
  ["groups.error.descMax", "Mô tả tối đa 400 ký tự", "Description can be at most 400 characters"],
  [
    "groups.error.betaProtected",
    "Group beta-testers có sẵn: không xoá hay đổi key được.",
    "The built-in beta-testers group can't be deleted or re-keyed.",
  ],
];

/** Nhãn e2e (plan-frontend §5) phải là giá trị ĐẦY ĐỦ của một key trong vi.json (khớp từng ký tự). */
const E2E_LABELS = [
  "+ Tạo group",
  "Group mới",
  "Tạo group",
  "Đổi tên",
  "Đổi tên group",
  "Thành viên",
  "Thêm người",
  "Dán danh sách username",
  "Mọi người đều có",
  "Có sẵn",
  "Thấy các feature đang Beta",
  "Group này chưa có thành viên.",
  "Tìm theo tên, key…",
  "Key",
  "Tên",
  "Mô tả",
  "Sửa",
  "Xoá",
  "Chọn một tenant để xem group của tenant đó.",
];

describe("ADM-FR-62 · M3-R24 · i18n VI/EN (groups)", () => {
  it("ADM-FR-62 · M3-R24 · vi.json và en.json có cùng tập key", () => {
    const vi = Object.keys(load("vi")).sort();
    const en = Object.keys(load("en")).sort();
    expect(en).toEqual(vi);
  });

  it("ADM-FR-62 · M3-R24 · mọi key nhóm groups (plan-frontend §7) có giá trị VI và EN nguyên văn", () => {
    const vi = load("vi");
    const en = load("en");
    const wrong: string[] = [];
    for (const [key, viText, enText] of TABLE) {
      if (vi[key] !== viText) wrong.push(`vi.${key}`);
      if (en[key] !== enText) wrong.push(`en.${key}`);
    }
    expect(wrong).toEqual([]);
  });

  it("ADM-FR-62 · M3-R24 · nhãn e2e nhóm groups xuất hiện làm giá trị đầy đủ trong vi.json", () => {
    const set = new Set(Object.values(load("vi")));
    expect(E2E_LABELS.filter((l) => !set.has(l))).toEqual([]);
  });
});
