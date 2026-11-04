// CR-118 · cr118-app-config · luật THUẦN "công ty/vai này sẽ thấy gì": ghép manifest dữ liệu của app + feature của công ty (đã lưu hoặc
// bản nháp chưa lưu) + vai của công ty + quy trình đang gán → menu, hành động và khe quy trình cho 3 vai. Không I/O. Shell web gộp
// đọc cùng manifest nên admin thấy đúng cái công ty sẽ thấy; luật thật vẫn chạy ở server (đây chỉ để trình bày).
import {
  APP_LEVELS,
  type AppAccessLevel,
  type AppAction,
  type AppGate,
  type AppManifest,
  PREVIEW_ROLES,
  type PreviewRole,
} from "./manifest";

export type PreviewRoleInfo = { pack: string; level: AppAccessLevel };
export type PreviewSlotAssign = {
  slot: string;
  def_name: string | null;
  rel_version: number | null;
  is_default: boolean;
};

/** Lý do một mục bị ẩn (web dịch thành câu: "cần tính năng Sửa", "đối tác không bao giờ thấy"…). */
export type HideReason =
  | { code: "app_off" }
  | { code: "need_level"; level: AppAccessLevel }
  | { code: "need_addon"; addon: string; label: string }
  | { code: "company_admin_only" }
  | { code: "partner_never" }
  | { code: "no_role"; level: AppAccessLevel };

export type PreviewAction = { key: string; label: string; visible: boolean; reason?: HideReason };
export type PreviewNavEntry = {
  key: string;
  label: string;
  visible: boolean;
  reason?: HideReason;
  /** Hành động chính của màn (chỉ có khi màn mở được). */
  actions: PreviewAction[];
};
export type PreviewSlot = {
  slot: string;
  label: string;
  /** Khe đang chạy quy trình thư viện (đủ mức + tính năng thêm); sai ⇒ app dùng cách mặc định cũ. */
  running: boolean;
  /** Vì sao khe không chạy. */
  reason?: HideReason;
  process: { name: string | null; version: number | null; isDefault: boolean } | null;
};
export type RolePreview = {
  role: PreviewRole;
  /** Mức của công ty đối với app (không phụ thuộc vai). */
  level: AppAccessLevel | "off";
  /** Nhóm app có hiện trong menu của vai này không (mọi mục đều ẩn ⇒ không hiện nhóm). */
  appVisible: boolean;
  nav: PreviewNavEntry[];
  slots: PreviewSlot[];
};

const rank = (l: AppAccessLevel | "off"): number => (l === "off" ? -1 : APP_LEVELS.indexOf(l));

/** Mức cao nhất đang có (khớp `detectLevel` của ai-admin). */
export function levelOf(
  manifest: Pick<AppManifest, "levelFeatures">,
  features: ReadonlySet<string>,
): AppAccessLevel | "off" {
  const top = [...APP_LEVELS].reverse().find((l) => features.has(manifest.levelFeatures[l]));
  return top ?? "off";
}

function gateReason(
  manifest: AppManifest,
  role: PreviewRole,
  level: AppAccessLevel | "off",
  features: ReadonlySet<string>,
  roles: readonly PreviewRoleInfo[],
  gate: AppGate,
): HideReason | undefined {
  if (role === "partner" && !gate.partner) return { code: "partner_never" };
  if (role !== "company_admin" && gate.audience === "company_admin")
    return { code: "company_admin_only" };
  if (level === "off") return { code: "app_off" };
  if (rank(level) < rank(gate.level)) return { code: "need_level", level: gate.level };
  if (gate.addon && !features.has(gate.addon)) {
    const label = manifest.addons.find((a) => a.key === gate.addon)?.label ?? gate.addon;
    return { code: "need_addon", addon: gate.addon, label };
  }
  if (role === "member") {
    const mine = roles.filter((r) => r.pack === manifest.key);
    // Công ty đã tạo vai cho app: thành viên chỉ mở được khi có ít nhất một vai đủ mức. Chưa có vai nào ⇒ theo mức của công ty.
    if (mine.length > 0 && !mine.some((r) => rank(r.level) >= rank(gate.level)))
      return { code: "no_role", level: gate.level };
  }
  return undefined;
}

function slotsOf(
  manifest: AppManifest,
  level: AppAccessLevel | "off",
  features: ReadonlySet<string>,
  assigns: readonly PreviewSlotAssign[],
): PreviewSlot[] {
  return manifest.slots.map((s) => {
    const a = assigns.find((x) => x.slot === s.key);
    const reason =
      level === "off"
        ? ({ code: "app_off" } as const)
        : rank(level) < rank(s.level)
          ? ({ code: "need_level", level: s.level } as const)
          : s.addon && !features.has(s.addon)
            ? ({
                code: "need_addon",
                addon: s.addon,
                label: manifest.addons.find((x) => x.key === s.addon)?.label ?? s.addon,
              } as const)
            : undefined;
    return {
      slot: s.key,
      label: s.label,
      running: !reason,
      ...(reason ? { reason } : {}),
      process: a ? { name: a.def_name, version: a.rel_version, isDefault: a.is_default } : null,
    };
  });
}

function previewRole(
  manifest: AppManifest,
  role: PreviewRole,
  features: ReadonlySet<string>,
  roles: readonly PreviewRoleInfo[],
  assigns: readonly PreviewSlotAssign[],
): RolePreview {
  const level = levelOf(manifest, features);
  const check = (g: AppGate) => gateReason(manifest, role, level, features, roles, g);
  const nav = manifest.nav.map((item): PreviewNavEntry => {
    const reason = check(item);
    const actions = reason
      ? []
      : (item.actions ?? []).map((a: AppAction): PreviewAction => {
          const r = check(a);
          return { key: a.key, label: a.label, visible: !r, ...(r ? { reason: r } : {}) };
        });
    return {
      key: item.key,
      label: item.label,
      visible: !reason,
      ...(reason ? { reason } : {}),
      actions,
    };
  });
  return {
    role,
    level,
    appVisible: nav.some((n) => n.visible),
    nav,
    // Đối tác không là người làm bước ở khe của app (ranh giới CR-118 câu 17) và không thấy quy trình của công ty chủ.
    slots: role === "partner" ? [] : slotsOf(manifest, level, features, assigns),
  };
}

/**
 * Xem trước một app cho 3 vai. `tenantFeatures` = tập key feature đang cấp cho công ty — truyền bản ĐANG LƯU hoặc bản NHÁP chưa lưu
 * (cùng tập key mà thẻ app đang giữ); `roles` = vai theo app của công ty; `slots` = quy trình đang chạy ở từng khe của công ty.
 */
export function previewApp(
  manifest: AppManifest,
  tenantFeatures: ReadonlySet<string>,
  roles: readonly PreviewRoleInfo[],
  slots: readonly PreviewSlotAssign[],
): Record<PreviewRole, RolePreview> {
  const out = {} as Record<PreviewRole, RolePreview>;
  for (const r of PREVIEW_ROLES) out[r] = previewRole(manifest, r, tenantFeatures, roles, slots);
  return out;
}
