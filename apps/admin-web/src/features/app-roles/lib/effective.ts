// CR-112 · ADM-FR-82 · ADM-BR-16 · quyền thực tế theo app (hàm thuần).
// (1) `levelsFromRoles`: bảng gán người — mức cao nhất trong các vai (đã tính thay đổi chưa lưu), vai vượt trần không tính.
// (2) `explainPacks`: Kiểm tra quyền — dựng từ `GET /admin/users/:id/effective-access` (feature `<k'>-read|write|admin` + group cấp):
//     mỗi nguồn là một vai (theo `group_id`), "quyền ngoài vai" (Group phòng ban/Group thường) hoặc gán lẻ cho user.
import {
  type AccessReason,
  type AppRoleLevel,
  type EffectiveAccess,
  levelRank,
  PACK_ACTIONS,
  packFeatureKey,
} from "@ai/contracts";
import { maxLevel } from "./levels";

export type LevelRole = { pack: string; level: AppRoleLevel; ceiling: AppRoleLevel | null };

/** Vai có hiệu lực khi mức ≤ trần công ty (trần null = app tắt ⇒ không hiệu lực). */
export const roleIsEffective = (level: AppRoleLevel, ceiling: AppRoleLevel | null): boolean =>
  ceiling !== null && levelRank(level) <= levelRank(ceiling);

export type PackLevel = { pack: string; level: AppRoleLevel | null; ineffectiveOnly: boolean };

/** Mỗi app người dùng có vai: `level` = mức cao nhất trong các vai hiệu lực; `ineffectiveOnly` khi có vai nhưng không vai nào hiệu lực. */
export function levelsFromRoles(roles: readonly LevelRole[]): PackLevel[] {
  const out = new Map<string, PackLevel>();
  for (const r of roles) {
    const cur = out.get(r.pack) ?? { pack: r.pack, level: null, ineffectiveOnly: true };
    if (roleIsEffective(r.level, r.ceiling)) {
      cur.level = maxLevel(cur.level, r.level);
      cur.ineffectiveOnly = false;
    }
    out.set(r.pack, cur);
  }
  return [...out.values()].sort((a, b) => a.pack.localeCompare(b.pack));
}

export type SourceKind = "role" | "outside" | "direct";
export type ExplainSource = {
  kind: SourceKind;
  /** Vai (kind=role) hoặc tên Group (kind=outside). */
  groupId?: string;
  groupName?: { vi: string; en?: string };
  /** Mức cao nhất mà nguồn này cấp (theo mã gói). */
  level: AppRoleLevel;
  /** Nguồn cấp mà feature tương ứng đang hiệu lực. */
  effective: boolean;
};
export type PackExplain = {
  pack: string;
  level: AppRoleLevel | null;
  sources: ExplainSource[];
};

function reasonKey(r: AccessReason): string | null {
  if (r.code === "grant_group") return `g:${r.group.id}`;
  return r.code === "grant_user" ? "u" : null;
}

function sourceOf(
  r: AccessReason,
  level: AppRoleLevel,
  effective: boolean,
  roleGroupIds: ReadonlySet<string>,
): ExplainSource {
  if (r.code !== "grant_group") return { kind: "direct", level, effective };
  const kind = roleGroupIds.has(r.group.id) ? "role" : "outside";
  return { kind, groupId: r.group.id, groupName: r.group.name, level, effective };
}

function explainPack(
  access: Pick<EffectiveAccess, "features">,
  pack: string,
  roleGroupIds: ReadonlySet<string>,
): PackExplain {
  const bySource = new Map<string, ExplainSource>();
  let top: AppRoleLevel | null = null;
  for (const action of PACK_ACTIONS) {
    const f = access.features.find((x) => x.feature.key === packFeatureKey(pack, action));
    if (!f) continue;
    if (f.effective) top = maxLevel(top, action);
    for (const r of f.reasons) {
      const key = reasonKey(r);
      // PACK_ACTIONS tăng dần: lần ghi sau cùng là mức cao nhất của nguồn (và hiệu lực của chính mức đó).
      if (key) bySource.set(key, sourceOf(r, action, f.effective, roleGroupIds));
    }
  }
  return { pack, level: top, sources: [...bySource.values()] };
}

/** `roleGroupIds`: group_id của các vai theo app (để tách "vai" khỏi "quyền ngoài vai"). */
export function explainPacks(
  access: Pick<EffectiveAccess, "features">,
  packs: readonly string[],
  roleGroupIds: ReadonlySet<string>,
): PackExplain[] {
  return packs.map((pack) => explainPack(access, pack, roleGroupIds));
}
