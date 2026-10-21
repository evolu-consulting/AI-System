// PK-FR-05 · D-05 · N1 plan §5: luật thuần bật gói — khoá feature/Group của gói, 6 cặp grant theo `PACK_ROLE_ACTIONS`,
// tên Group mặc định, dựng `PackState` từ Group đọc lại.
import {
  PACK_ACTIONS,
  PACK_ROLE_ACTIONS,
  PACK_ROLES,
  type PackRole,
  type PackState,
  packFeatureKey,
  packGroupKey,
} from "@ai/contracts";

/** Nhãn hiển thị của gói (chỉ tên hiển thị; khoá nội bộ không đổi). Gói lạ ⇒ dùng chính khoá gói. */
const PACK_LABEL: Record<string, { vi: string; en: string }> = {
  contracts: { vi: "Sổ Hợp Tác", en: "Contract Book" },
  knowledge: { vi: "Tài liệu nội bộ", en: "Internal Documents" },
};

const ROLE_LABEL: Record<PackRole, { vi: string; en: string; descVi: string }> = {
  owner: {
    vi: "Toàn quyền",
    en: "Full access",
    descVi: "Xem, sửa và quản trị mọi thứ trong",
  },
  editor: {
    vi: "Nhân viên",
    en: "Staff",
    descVi: "Xem và nhập, chỉnh sửa dữ liệu trong",
  },
  viewer: { vi: "Chỉ xem", en: "View only", descVi: "Chỉ xem, không sửa dữ liệu trong" },
};

/** Tên Group vai cũ (`<k> · Chủ sở hữu`…) — migration 0022 chỉ đổi tên nếu còn đúng giá trị này. */
export const LEGACY_ROLE_NAME_VI: Record<PackRole, string> = {
  owner: "Chủ sở hữu",
  editor: "Biên tập",
  viewer: "Xem",
};
export const packFeatureKeys = (k: string): string[] =>
  PACK_ACTIONS.map((a) => packFeatureKey(k, a));
export const packGroupKeys = (k: string): string[] => PACK_ROLES.map((r) => packGroupKey(k, r));

/** Hàng Group vai: key `<k'>-<vai>`, tên `{"vi": "Sổ Hợp Tác – Toàn quyền", "en": …}` + mô tả ngắn. */
export function roleGroupRows(
  k: string,
): { key: string; name: { vi: string; en: string }; description: string }[] {
  const p = PACK_LABEL[k] ?? { vi: k, en: k };
  return PACK_ROLES.map((r) => ({
    key: packGroupKey(k, r),
    name: { vi: `${p.vi} – ${ROLE_LABEL[r].vi}`, en: `${p.en} – ${ROLE_LABEL[r].en}` },
    description: `${ROLE_LABEL[r].descVi} ${p.vi}`,
  }));
}
/** 6 cặp (Group → feature): viewer=read · editor=read+write · owner=read+write+admin. */
export function roleGrantPairs(k: string): { grp: string; feat: string }[] {
  return PACK_ROLES.flatMap((r) =>
    PACK_ROLE_ACTIONS[r].map((a) => ({ grp: packGroupKey(k, r), feat: packFeatureKey(k, a) })),
  );
}

/** Gói đã cài ⇔ đủ 3 feature (`packs.install`). */
export const isInstalled = (k: string, found: readonly { key: string }[]): boolean => {
  const have = new Set(found.map((f) => f.key));
  return packFeatureKeys(k).every((key) => have.has(key));
};

/** `PackState` từ Group đọc lại (key → vai); Group lạ bị bỏ. */
export function packState(
  k: string,
  enabled: boolean,
  groups: readonly { id: string; key: string }[],
): PackState {
  const roleOf = new Map(PACK_ROLES.map((r) => [packGroupKey(k, r), r] as const));
  const out: PackState["groups"] = [];
  for (const g of groups) {
    const role = roleOf.get(g.key);
    if (role) out.push({ role, group_id: g.id });
  }
  return { key: k, enabled, groups: out };
}
