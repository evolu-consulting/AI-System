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

const ROLE_NAME_VI: Record<PackRole, string> = {
  owner: "Chủ sở hữu",
  editor: "Biên tập",
  viewer: "Xem",
};

export const packFeatureKeys = (k: string): string[] =>
  PACK_ACTIONS.map((a) => packFeatureKey(k, a));
export const packGroupKeys = (k: string): string[] => PACK_ROLES.map((r) => packGroupKey(k, r));

/** Hàng Group vai: key `<k'>-<vai>`, tên `{"vi": "<k> · <vai>"}`. */
export function roleGroupRows(k: string): { key: string; name: { vi: string } }[] {
  return PACK_ROLES.map((r) => ({
    key: packGroupKey(k, r),
    name: { vi: `${k} · ${ROLE_NAME_VI[r]}` },
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
