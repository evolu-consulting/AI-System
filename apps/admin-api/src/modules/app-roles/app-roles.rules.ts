// CR-112 · ADM-BR-15/16 · luật thuần của vai theo app: mức ⇒ tập mã gói (giống hệt Group vai mặc định cùng mức), kế hoạch
// biên dịch (phạm vi = 3 mã gói trên Group của vai; mong muốn = mã theo mức), trần công ty ⇒ hiệu lực, khoá Group của vai.
import {
  type AppRoleLevel,
  LEVEL_ACTIONS,
  levelRank,
  PACK_ACTIONS,
  packFeatureKey,
  packGroupKey,
} from "@ai/contracts";

/** Độ dài tối đa của `admin.groups.key` (CHECK `^[a-z0-9-]{2,32}$`). */
const GROUP_KEY_MAX = 32;

export const desiredFeatureKeys = (pack: string, level: AppRoleLevel): string[] =>
  LEVEL_ACTIONS[level].map((a) => packFeatureKey(pack, a));

/** 3 mã gói `<k'>-read|write|admin` — chỉ các mã này trên Group của vai là do biên dịch quản. */
export const packCodeKeys = (pack: string): string[] =>
  PACK_ACTIONS.map((a) => packFeatureKey(pack, a));

export const roleGroupKey = (pack: string, key: string): string => packGroupKey(pack, key);
export const roleKeyFits = (pack: string, key: string): boolean =>
  roleGroupKey(pack, key).length <= GROUP_KEY_MAX;

export type CompileRole = { group_id: string; pack: string; level: AppRoleLevel };
export type GroupFeature = { g: string; f: string };

/**
 * Diff tập hợp: `scope` = 3 mã gói trên Group của mỗi vai; `want` = mã theo mức; `drop` = scope ∖ want (xoá nếu có).
 * Grant ngoài scope (feature khác, Group khác) không bao giờ bị đụng.
 */
export function compilePlan(roles: readonly CompileRole[]): {
  scope: GroupFeature[];
  want: GroupFeature[];
  drop: GroupFeature[];
} {
  const scope = roles.flatMap((r) => packCodeKeys(r.pack).map((f) => ({ g: r.group_id, f })));
  const want = roles.flatMap((r) =>
    desiredFeatureKeys(r.pack, r.level).map((f) => ({ g: r.group_id, f })),
  );
  const keep = new Set(want.map((w) => `${w.g}|${w.f}`));
  return { scope, want, drop: scope.filter((s) => !keep.has(`${s.g}|${s.f}`)) };
}

/** Trần công ty của app = mức cao nhất có entitlement còn hiệu lực (CR-111); không có ⇒ null (app tắt). */
export function ceilingOf(pack: string, entitledKeys: readonly string[]): AppRoleLevel | null {
  const have = new Set(entitledKeys);
  let top: AppRoleLevel | null = null;
  for (const a of PACK_ACTIONS) if (have.has(packFeatureKey(pack, a))) top = a;
  return top;
}

export const isEffective = (level: AppRoleLevel, ceiling: AppRoleLevel | null): boolean =>
  ceiling !== null && levelRank(level) <= levelRank(ceiling);

/** Khoá vai tự sinh khi tạo không kèm `key`: `r-` + 8 ký tự hex (Group key ≤ 32 với mọi khoá gói ≤ 21). */
export const generatedRoleKey = (uuid: string): string => `r-${uuid.replaceAll("-", "").slice(-8)}`;
