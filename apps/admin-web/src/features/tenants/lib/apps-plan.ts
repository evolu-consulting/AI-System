// CR-112 · ADM-FR-78 · luật thuần của tab "Ứng dụng & Gói": mức của app điều khiển CẢ gói (bật/tắt) lẫn entitlement; kế hoạch lưu
// một lượt theo thứ tự an toàn: BẬT gói → cấp/thu hồi entitlement → TẮT gói (thu hồi trước khi tắt), và chạy kế hoạch với lỗi từng phần.
import type { Level } from "@/features/features/lib/feature-meta";
import { LEVELS } from "@/features/features/lib/feature-meta";
import {
  type AppCard,
  type AppLevel,
  detectLevel,
  diffEntitlements,
  entitledKeys,
  type TenantFeature,
} from "./feature-assign";

export type PackInfo = {
  key: string;
  enabled: boolean;
  role_count?: number;
  member_count?: number;
};
export type RoleInfo = { pack: string; level: Level };
/** Ý định bật/tắt gói theo app, đặt khi người dùng chọn mức (app → true = bật gói, false = tắt gói). */
export type PackIntent = Readonly<Record<string, boolean>>;

/**
 * tenant_admin không gọi được GET packs (chỉ platform): suy gói từ thẻ app dạng mức — bật ⇔ có entitlement mức Xem; số vai/người
 * từ danh sách vai (người = tổng thành viên các vai, có thể đếm trùng người giữ 2 vai).
 */
export function derivePacks(
  cards: readonly AppCard[],
  roles: readonly { pack: string; member_count: number }[],
): PackInfo[] {
  return cards
    .filter((c) => c.mode === "levels")
    .map((c) => {
      const mine = roles.filter((r) => r.pack === c.app);
      return {
        key: c.app,
        enabled: c.levelFeatures.read?.entitled === true,
        role_count: mine.length,
        member_count: mine.reduce((n, r) => n + r.member_count, 0),
      };
    });
}

/** Gói của một thẻ app: chỉ app dạng mức (Xem/Sửa/Quản trị) có gói trùng tên. */
export function packOf(card: AppCard, packs: readonly PackInfo[]): PackInfo | undefined {
  return card.mode === "levels" ? packs.find((p) => p.key === card.app) : undefined;
}

export type AppsPlan = {
  /** Gói cần bật (làm trước: bật gói cấp entitlement tới đúng mức đích `enableLevels[k]`). */
  enablePacks: string[];
  /** Mức đích khi bật gói (PUT `?level=`): lỗi ở bước sau thì trần công ty không bị đẩy lên Quản trị. */
  enableLevels?: Readonly<Record<string, Level>>;
  grant: TenantFeature[];
  /** Mọi việc thu hồi (kể cả mức thừa sau khi bật gói). */
  revoke: TenantFeature[];
  /** Phần thu hồi người dùng đang có thật (đưa vào hộp xác nhận). */
  revokeShown: TenantFeature[];
  /** Gói cần tắt (làm sau cùng, sau khi đã thu hồi entitlement của app). */
  disablePacks: string[];
};

/** Việc cần làm để đưa trạng thái hiện có (entitlement + gói) về `draft` + `intent`. */
export function planChanges(
  features: readonly TenantFeature[],
  cards: readonly AppCard[],
  packs: readonly PackInfo[],
  draft: ReadonlySet<string>,
  intent: PackIntent,
): AppsPlan {
  const enablePacks: string[] = [];
  const enableLevels: Record<string, Level> = {};
  const disablePacks: string[] = [];
  const afterEnable = new Set<string>(); // key mức mà bật gói sẽ cấp thêm (tới đúng mức đích)
  for (const card of cards) {
    const pack = packOf(card, packs);
    const want = pack ? intent[card.app] : undefined;
    if (!pack || want === undefined || want === pack.enabled) continue;
    if (!want) {
      disablePacks.push(pack.key);
      continue;
    }
    const target = detectLevel(card, draft).level;
    const level: Level = target === "off" ? "read" : target;
    enablePacks.push(pack.key);
    enableLevels[pack.key] = level;
    for (const l of LEVELS.slice(0, LEVELS.indexOf(level) + 1)) {
      const f = card.levelFeatures[l];
      if (f) afterEnable.add(f.key);
    }
  }
  const own = new Set(entitledKeys(features));
  const virtual = features.map((f) => (afterEnable.has(f.key) ? { ...f, entitled: true } : f));
  const revoke = diffEntitlements(virtual, draft).revoke;
  return {
    enablePacks,
    enableLevels,
    // Cấp theo trạng thái thật: PUT entitlement đã có là idempotent, nên không phụ thuộc gói có tự cấp hay không.
    grant: diffEntitlements(features, draft).grant,
    revoke,
    revokeShown: revoke.filter((f) => own.has(f.key)),
    disablePacks,
  };
}

export const planSize = (p: AppsPlan): number =>
  p.enablePacks.length + p.grant.length + p.revoke.length + p.disablePacks.length;

/** Đặt mức: ghi nhớ ý định gói; về đúng mức đang có ⇒ bỏ ý định (không đổi gói). */
export function nextIntent(
  intent: PackIntent,
  app: string,
  level: AppLevel,
  baseline: AppLevel,
): PackIntent {
  const next = { ...intent };
  if (level === baseline) delete next[app];
  else next[app] = level !== "off";
  return next;
}

/** Số vai của gói và số vai "không hiệu lực" nếu mức công ty là `level` (vai cao hơn trần; app Tắt ⇒ mọi vai). */
export function roleStats(
  roles: readonly RoleInfo[],
  pack: string,
  level: AppLevel,
): { total: number; ineffective: number } {
  const mine = roles.filter((r) => r.pack === pack);
  const cap = level === "off" ? -1 : LEVELS.indexOf(level);
  return {
    total: mine.length,
    ineffective: mine.filter((r) => LEVELS.indexOf(r.level) > cap).length,
  };
}

export type PlanIO = {
  /** `level` chỉ khi bật: gói cấp entitlement tới đúng mức đó. */
  setPack: (key: string, on: boolean, level?: Level) => Promise<unknown>;
  /** Cấp/thu hồi entitlement (id feature); ném lỗi đầu tiên sau khi đã thử hết. */
  apply: (grant: string[], revoke: string[]) => Promise<void>;
};

/** Lỗi từng phần: `done` = các bước đã áp dụng (nhãn `pack+:k`, `entitlements`, `pack-:k`); phần còn lại chưa chạy. */
export class PlanError extends Error {
  constructor(
    readonly reason: unknown,
    readonly done: string[],
  ) {
    super(reason instanceof Error ? reason.message : "plan failed");
  }
}

async function settlePacks(
  keys: readonly string[],
  on: boolean,
  io: PlanIO,
  done: string[],
  levels: Readonly<Record<string, Level>> = {},
): Promise<void> {
  const res = await Promise.allSettled(keys.map((k) => io.setPack(k, on, levels[k])));
  res.forEach((r, i) => {
    if (r.status === "fulfilled") done.push(`${on ? "pack+" : "pack-"}:${keys[i]}`);
  });
  const bad = res.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (bad) throw new PlanError(bad.reason, done);
}

/** Chạy theo phase, dừng ở phase lỗi đầu tiên: bật gói → entitlement (cấp+thu hồi) → tắt gói. */
export async function runPlan(plan: AppsPlan, io: PlanIO): Promise<string[]> {
  const done: string[] = [];
  await settlePacks(plan.enablePacks, true, io, done, plan.enableLevels);
  if (plan.grant.length + plan.revoke.length > 0) {
    try {
      await io.apply(
        plan.grant.map((f) => f.id),
        plan.revoke.map((f) => f.id),
      );
    } catch (reason) {
      throw new PlanError(reason, done);
    }
    done.push("entitlements");
  }
  await settlePacks(plan.disablePacks, false, io, done);
  return done;
}
