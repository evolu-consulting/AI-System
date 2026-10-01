// ADM-FR-50, ADM-FR-10, ADM-FR-20, ADM-FR-30 · M2-R28 · chuỗi giao diện song ngữ VI/EN của M2
// (test-plan C1; plan-frontend §5, §7; admin-missing-screens §2, §3, §6). Không DB.
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
/** `many("a.b.", ["x","y"], ["VI x","VI y"], ["EN x","EN y"])` → [a.b.x, VI x, EN x], … */
function many(prefix: string, keys: string[], vi: string[], en: string[]): Row[] {
  return keys.map((k, i) => [`${prefix}${k}`, vi[i] ?? "", en[i] ?? ""]);
}

const TABLE: Row[] = [
  // ---- menu (plan-frontend §7) ----
  ["nav.group.features", "CHỨC NĂNG", "FEATURES"],
  ["nav.group.security", "BẢO MẬT", "SECURITY"],
  ...many(
    "nav.",
    ["commands", "workflows", "features", "secrets"],
    ["Commands", "Workflows", "Features", "Secrets"],
    ["Commands", "Workflows", "Features", "Secrets"],
  ),
  ["common.dismiss", "Đóng", "Close"],
  // ---- Secrets (missing-screens §6 + plan-frontend §7) ----
  ["secrets.list.title", "Secrets", "Secrets"],
  [
    "secrets.list.subtitle",
    "Key dùng chung cho workflow. Giá trị chỉ ghi, không xem lại được.",
    "Shared keys for workflows. Values are write-only and can't be viewed again.",
  ],
  ["secrets.list.create", "+ Thêm secret", "+ Add secret"],
  ...many(
    "secrets.col.",
    ["name", "value", "note", "usedBy", "updated"],
    ["Tên", "Giá trị", "Ghi chú", "Đang được dùng bởi", "Cập nhật"],
    ["Name", "Value", "Note", "Used by", "Updated"],
  ),
  ["secrets.filter.used", "Đang dùng", "In use"],
  ["secrets.filter.unused", "Chưa dùng", "Unused"],
  ...many(
    "secrets.menu.",
    ["replace", "editNote", "delete"],
    ["Thay giá trị", "Sửa ghi chú", "Xoá"],
    ["Replace value", "Edit note", "Delete"],
  ),
  ...many(
    "secrets.field.",
    ["name", "value", "note", "newValue", "show", "hide"],
    ["Tên", "Giá trị", "Ghi chú", "Giá trị mới", "Hiện giá trị đang gõ", "Ẩn giá trị"],
    ["Name", "Value", "Note", "New value", "Show typed value", "Hide value"],
  ),
  [
    "secrets.replace.current",
    "Giá trị hiện tại: •••• {last4} · cập nhật {date} bởi {user}",
    "Current value: •••• {last4} · updated {date} by {user}",
  ],
  ["secrets.replace.submit", "Lưu giá trị mới", "Save new value"],
  [
    "secrets.toast.replaced",
    "Đã thay giá trị {name} · •••• {last4}",
    "Replaced {name} · •••• {last4}",
  ],
  [
    "secrets.toast.viewWorkflows",
    "Xem các workflow dùng secret này",
    "View workflows using this secret",
  ],
  ["secrets.toast.created", "Đã thêm {name}", "Added {name}"],
  ["secrets.toast.deleted", "Đã xoá {name}", "Deleted {name}"],
  [
    "secrets.delete.blocked",
    "Không xoá được {name}: đang được dùng bởi",
    "Can't delete {name}: used by",
  ],
  [
    "secrets.error.nameFormat",
    "Chỉ dùng chữ HOA, số và _ (2–64 ký tự)",
    "Use uppercase letters, digits and _ only (2–64 chars)",
  ],
  ["secrets.error.nameTaken", "Tên secret đã tồn tại", "A secret with this name already exists"],
  ["secrets.error.valueRequired", "Nhập giá trị secret", "Enter the secret value"],
  ["secrets.error.valueLength", "Giá trị dài 8–2048 ký tự", "Value must be 8–2048 characters"],
  ["secrets.error.noteMax", "Ghi chú tối đa 200 ký tự", "Note can be at most 200 characters"],
  [
    "secrets.empty",
    "Chưa có secret nào. Secret lưu app key Dify để workflow gọi được.",
    "No secrets yet. Secrets store Dify app keys so workflows can call them.",
  ],
  // ---- Workflows (plan-frontend §7) ----
  ["workflows.list.title", "Workflows", "Workflows"],
  ["workflows.list.create", "+ Khai báo workflow", "+ Declare workflow"],
  ["workflows.list.search", "Tìm theo tên, key, mô tả…", "Search by name, key, description…"],
  ...many(
    "workflows.filter.",
    ["all", "on", "off", "unattached"],
    ["Tất cả", "Bật", "Tắt", "Chưa gắn"],
    ["All", "Enabled", "Disabled", "Unattached"],
  ),
  ["workflows.unattached", "Chưa gắn", "Unattached"],
  ...many(
    "workflows.menu.",
    ["edit", "enable", "disable", "createCommand", "delete"],
    ["Sửa", "Bật", "Tắt", "Tạo command", "Xoá"],
    ["Edit", "Enable", "Disable", "Create command", "Delete"],
  ),
  [
    "workflows.createCommandFrom",
    "Tạo command từ workflow này",
    "Create a command from this workflow",
  ],
  ...many(
    "workflows.tab.",
    ["info", "input", "preview", "usage"],
    ["Thông tin", "Input", "Model thấy gì", "Đang được dùng bởi"],
    ["Details", "Input", "What the model sees", "Used by"],
  ),
  ...many(
    "workflows.field.",
    ["key", "name", "type", "secret", "baseUrl", "outputField", "description", "enabled"],
    ["Key", "Tên", "Loại", "Secret", "Base URL", "Output field", "Mô tả", "Bật workflow"],
    ["Key", "Name", "Type", "Secret", "Base URL", "Output field", "Description", "Enable workflow"],
  ),
  ...many(
    "workflows.schema.",
    ["title", "add", "max"],
    ["Input", "+ Thêm tham số", "Tối đa 50 tham số"],
    ["Input", "+ Add parameter", "At most 50 parameters"],
  ),
  ...many(
    "workflows.schema.col.",
    ["name", "type", "required", "description", "options"],
    ["Tên tham số", "Kiểu", "Bắt buộc", "Mô tả tham số", "Lựa chọn"],
    ["Parameter name", "Type", "Required", "Parameter description", "Options"],
  ),
  [
    "workflows.blocked.disable",
    "Không tắt được {key}: đang được dùng bởi",
    "Can't disable {key}: used by",
  ],
  ["workflows.delete.title", "Xoá {key}?", "Delete {key}?"],
  [
    "workflows.delete.blocked",
    "Không xoá được {key}: đang được dùng bởi",
    "Can't delete {key}: used by",
  ],
  ["workflows.delete.typeToConfirm", "Gõ {key} để xác nhận", "Type {key} to confirm"],
  ["workflows.delete.submit", "Xoá workflow", "Delete workflow"],
  [
    "workflows.schemaBreaks",
    "Không lưu được: thay đổi này làm hỏng các command sau. Sửa chúng trước.",
    "Can't save: this change breaks these commands. Fix them first.",
  ],
  ["workflows.error.descLength", "Mô tả dài 20–400 ký tự", "Description must be 20–400 characters"],
  ["workflows.error.secretRequired", "Chọn một secret", "Choose a secret"],
  ["workflows.error.paramDesc", "Mô tả tham số là bắt buộc", "Parameter description is required"],
  // ---- Commands (missing-screens §2 + plan-frontend §7) ----
  ["commands.list.title", "Commands", "Commands"],
  ["commands.list.create", "+ Tạo command", "+ New command"],
  ["commands.list.search", "Tìm theo tên, alias, mô tả…", "Search by name, alias, description…"],
  ["commands.list.workflowOff", "Bật workflow {key} trước", "Enable workflow {key} first"],
  ["commands.list.toggle.aria", "Bật command /{name}", "Enable command /{name}"],
  ["commands.toast.disabled", "Đã tắt /{name}", "Disabled /{name}"],
  ["commands.toast.enabled", "Đã bật /{name}", "Enabled /{name}"],
  ["commands.toast.deleted", "Đã xoá /{name}", "Deleted /{name}"],
  ["commands.delete.title", "Xoá /{name}?", "Delete /{name}?"],
  ["commands.delete.typeToConfirm", "Gõ {name} để xác nhận", "Type {name} to confirm"],
  ["commands.delete.submit", "Xoá command", "Delete command"],
  ["commands.tab.config", "Cấu hình", "Configuration"],
  ["commands.tab.access", "Ai dùng được", "Who can use it"],
  ["commands.field.name", "Tên command", "Command name"],
  ["commands.field.alias", "Alias", "Alias"],
  ["commands.field.aliasAdd", "Thêm alias", "Add alias"],
  ["commands.field.featuresAdd", "Thêm feature", "Add feature"],
  ["commands.field.workflow", "Workflow", "Workflow"],
  ["commands.field.outputField", "Output field", "Output field"],
  ["commands.field.render", "Hiển thị", "Display"],
  ["commands.field.timeout", "Timeout (giây)", "Timeout (seconds)"],
  ["commands.alias.remove.aria", "Bỏ alias {name}", "Remove alias {name}"],
  ["commands.feature.remove.aria", "Bỏ feature {name}", "Remove feature {name}"],
  ["commands.args.add", "+ Thêm tham số", "+ Add parameter"],
  ...many(
    "commands.map.source.",
    ["arg", "selection", "page_url", "page_text", "attachment", "user_id", "tenant_id", "const"],
    [
      "Tham số",
      "Đoạn bôi đen",
      "URL trang",
      "Nội dung trang",
      "File đính kèm",
      "ID người dùng",
      "ID tenant",
      "Giá trị cố định",
    ],
    [
      "Parameter",
      "Selection",
      "Page URL",
      "Page text",
      "Attachment",
      "User ID",
      "Tenant ID",
      "Fixed value",
    ],
  ),
  ["commands.map.source.aria", "Nguồn của {name}", "Source of {name}"],
  ["commands.map.arg.aria", "Tham số của {name}", "Parameter for {name}"],
  ["commands.map.value.aria", "Giá trị của {name}", "Value for {name}"],
  [
    "commands.map.dropped",
    "Đã bỏ map của: {names} (workflow mới không có các input này).",
    "Dropped mappings for: {names} (the new workflow has no such inputs).",
  ],
  ["commands.error.mapMissing", "thiếu input bắt buộc: {names}", "missing required input: {names}"],
  [
    "commands.error.featureRequired",
    "Command phải thuộc ít nhất một feature",
    "A command must belong to at least one feature",
  ],
  [
    "commands.error.workflowDisabled",
    "Workflow đang tắt. Bật workflow trước.",
    "The workflow is disabled. Enable it first.",
  ],
  [
    "commands.error.nameTaken",
    "/{name} đã được dùng bởi command khác",
    "/{name} is already used by another command",
  ],
  ["commands.toast.saved", "Đã lưu /{name}", "Saved /{name}"],
  [
    "commands.access.groupsLater",
    "Quyền theo nhóm và người dùng chưa khả dụng.",
    "Group and user access isn't available yet.",
  ],
  [
    "commands.access.summary",
    "{tenants} tenant · {users} user",
    "{tenants} tenants · {users} users",
  ],
  // ---- Features (missing-screens §3 + plan-frontend §7) ----
  ["features.list.title", "Features", "Features"],
  ["features.list.create", "+ Tạo feature", "+ New feature"],
  ...many(
    "features.status.",
    ["on", "beta", "off"],
    ["Bật", "Beta", "Tắt"],
    ["Enabled", "Beta", "Disabled"],
  ),
  ["features.default", "Mặc định", "Default"],
  ["features.allTenants", "Mọi tenant", "All tenants"],
  ["features.menu.toBeta", "Chuyển sang Beta", "Move to Beta"],
  ...many(
    "features.tab.",
    ["info", "commands", "tenants"],
    ["Thông tin", "Commands", "Tenant"],
    ["Details", "Commands", "Tenants"],
  ),
  [
    "features.field.keyLocked",
    "Key không đổi được sau khi tạo",
    "Key can't be changed after creation",
  ],
  [
    "features.field.betaHint",
    "Chỉ group beta-testers thấy",
    "Only the beta-testers group can see it",
  ],
  [
    "features.core.hint",
    "Feature mặc định: luôn bật và tự có hiệu lực với mọi người dùng",
    "Default feature: always on and available to every user",
  ],
  ["features.commands.add", "Thêm command", "Add command"],
  ["features.commands.remove.aria", "Bỏ /{name} khỏi feature", "Remove /{name} from feature"],
  [
    "features.commands.orphan",
    "/{name} sẽ không thuộc feature nào và biến khỏi menu",
    "/{name} will belong to no feature and disappear from the menu",
  ],
  ["features.tenants.grant", "+ Cấp cho tenant", "+ Grant to tenant"],
  ["features.tenants.revoke", "Thu hồi", "Revoke"],
  [
    "features.tenants.coreAll",
    "Feature core được cấp cho mọi tenant.",
    "The core feature is granted to every tenant.",
  ],
  ["features.revoke.title", "Thu hồi {feature} của {tenant}?", "Revoke {feature} from {tenant}?"],
  ["features.revoke.typeToConfirm", "Gõ {tenant} để xác nhận", "Type {tenant} to confirm"],
  [
    "features.toast.revoked",
    "Đã thu hồi {feature} của {tenant}",
    "Revoked {feature} from {tenant}",
  ],
  ["features.disable.title", "Tắt {feature}?", "Disable {feature}?"],
  ["features.disable.submit", "Tắt feature", "Disable feature"],
  [
    "features.delete.blocked",
    "Không xoá được {feature}: các command sau chỉ thuộc feature này. Chuyển chúng sang feature khác trước.",
    "Can't delete {feature}: these commands belong only to it. Move them to another feature first.",
  ],
  [
    "features.error.coreProtected",
    "Feature core không thể xoá, tắt hay đổi sang Beta",
    "The core feature can't be deleted, disabled or moved to Beta",
  ],
];

/** Nhãn e2e M2 (plan-frontend §5 + missing-screens §2, §3, §6): phải có làm giá trị VI đầy đủ. */
const E2E_LABELS = [
  "Secrets",
  "+ Thêm secret",
  "Thay giá trị",
  "Sửa ghi chú",
  "Giá trị mới",
  "Hiện giá trị đang gõ",
  "Lưu giá trị mới",
  "Xem các workflow dùng secret này",
  "+ Khai báo workflow",
  "Tìm theo tên, key, mô tả…",
  "Chưa gắn",
  "Model thấy gì",
  "Đang được dùng bởi",
  "Bật workflow",
  "+ Thêm tham số",
  "Tạo command từ workflow này",
  "Xoá workflow",
  "Cấu hình",
  "Ai dùng được",
  "Tên command",
  "Thêm alias",
  "Thêm feature",
  "Timeout (giây)",
  "Hiển thị",
  "Nhân bản",
  "+ Tạo command",
  "Tìm theo tên, alias, mô tả…",
  "Xoá command",
  "+ Tạo feature",
  "Thêm command",
  "+ Cấp cho tenant",
  "Thu hồi",
  "Tắt feature",
  "Chuyển sang Beta",
  "Hoàn tác",
  "Đóng",
];

/** Chuỗi KHÔNG được có (nút bị bỏ ở M2, R28). */
const FORBIDDEN_VALUE = [/Kiểm tra kết nối/, /Lấy từ Dify/, /Chạy thử/, /Lịch sử/];

describe("ADM-FR-50 · M2-R28 · i18n VI/EN", () => {
  it("ADM-FR-50 · M2-R28 · vi.json và en.json có cùng tập key", () => {
    const vi = Object.keys(load("vi")).sort();
    const en = Object.keys(load("en")).sort();
    expect(en).toEqual(vi);
  });

  it("ADM-FR-10 · M2-R28 · mọi key M2 (plan-frontend §7, missing-screens §2, 3, 6) có giá trị VI và EN nguyên văn", () => {
    const vi = load("vi");
    const en = load("en");
    const wrong: string[] = [];
    for (const [key, viText, enText] of TABLE) {
      if (vi[key] !== viText) wrong.push(`vi.${key}`);
      if (en[key] !== enText) wrong.push(`en.${key}`);
    }
    expect(wrong).toEqual([]);
  });

  it("ADM-FR-20 · M2-R28 · nhãn e2e M2 xuất hiện làm giá trị đầy đủ trong vi.json; không có nút Kiểm tra kết nối/Lấy từ Dify/Chạy thử/Lịch sử", () => {
    const values = Object.values(load("vi"));
    const set = new Set(values);
    expect(E2E_LABELS.filter((l) => !set.has(l))).toEqual([]);
    const bad = values.filter((v) => FORBIDDEN_VALUE.some((re) => re.test(v)));
    expect(bad).toEqual([]);
  });

  it("ADM-FR-50 · M2-R28 · bun run i18n:check exit 0", () => {
    const p = Bun.spawnSync(["bun", "tools/scripts/src/i18n-check.ts"], { cwd: ROOT });
    expect(p.exitCode).toBe(0);
  });
});
