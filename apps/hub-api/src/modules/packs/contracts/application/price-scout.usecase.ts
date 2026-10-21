// price-scout · cấu hình dò giá (SP + mặc định nhóm + trần tháng) và lượt dò bấm tay. Lượt dò: SP thuộc tenant (không phải Giới
// thiệu) ⇒ giữ một lượt trong trần tháng (hết ⇒ `month_cap`, không gọi agent) ⇒ trần thao tác AI/ngày ⇒ agent `price-scout` với lời
// nhắc dữ liệu CHỈ tên SP + cấu hình dò ⇒ cộng token ⇒ parse chặt (loại trang bị loại, quy VAT). Kết quả KHÔNG tự lưu (như V2-J2).
import type { PackUow, PackWho } from "../../kit/application/ports";
import { localDate } from "../domain/local-time.rules";
import {
  effectiveConfig,
  groupDefaults,
  monthStart,
  nextScoutAt,
  SCOUT_MONTHLY_DEFAULT,
  scoutLimits,
  scoutPrompt,
  toExVat,
} from "../domain/price-scout.rules";
import type {
  PriceScoutConfig,
  PriceScoutDefaultsOut,
  PriceScoutGroup,
  PriceScoutOverride,
  PriceScoutProductOut,
  PriceScoutQuotaOut,
  PriceScoutQuotaRow,
  PriceScoutUsage,
} from "../domain/price-scout.types";
import { parseSearchReply } from "../domain/price-search.rules";
import type { SupplierSearchOut } from "../domain/supplier-prices.types";
import type { ActionQuota } from "./ai.ports";
import type { ScoutAgent, ScoutRepo } from "./price-scout.ports";

export class ScoutFail extends Error {
  constructor(
    readonly kind:
      | "not_found"
      | "month_cap"
      | "unavailable"
      | "disabled"
      | "cap"
      | "failed"
      | "forbidden",
  ) {
    super(kind);
  }
}

export type ScoutDeps = {
  uow: PackUow<{ scout: ScoutRepo }>;
  agent: ScoutAgent;
  quota: ActionQuota;
  /** agents-background · agent dò giá còn bật cho công ty (false ⇒ `disabled`, không giữ lượt, không gọi agent). Vắng ⇒ bật. */
  enabled?: (tenantId: string) => Promise<boolean>;
  timeZoneOf: (tenantId: string) => Promise<string>;
  /** Trần lượt dò/tháng mặc định của hệ thống (khi tenant/platform chưa đặt). */
  systemSearches?: number;
  now?: () => Date;
  timeoutMs?: number;
};

export const SCOUT_TIMEOUT_MS = 180_000;

function usageOut(
  u: { searches: number; tokens: number; quota: PriceScoutQuotaRow | null },
  month: string,
  sys: number,
): PriceScoutUsage {
  const l = scoutLimits(u.quota, sys);
  return {
    month: month.slice(0, 7),
    searches: u.searches,
    tokens: u.tokens,
    searches_limit: l.searches,
    tokens_limit: l.tokens,
  };
}

const failOf = (code: string): ScoutFail =>
  new ScoutFail(
    code === "CAP_EXCEEDED"
      ? "cap"
      : code === "UNAVAILABLE"
        ? "unavailable"
        : code === "DISABLED"
          ? "disabled"
          : "failed",
  );

function scoutCtx(d: ScoutDeps) {
  const now = d.now ?? (() => new Date());
  const sys = d.systemSearches ?? SCOUT_MONTHLY_DEFAULT;
  const tx = <T>(who: PackWho, fn: (r: ScoutRepo) => Promise<T>) =>
    d.uow.tenant(who, (r) => fn(r.scout));
  const today = async (who: PackWho) => localDate(now(), await d.timeZoneOf(who.tenantId));
  async function product(r: ScoutRepo, id: string) {
    const p = await r.product(id);
    if (!p || p.group === "referral") throw new ScoutFail("not_found");
    return { ...p, group: p.group as PriceScoutGroup };
  }
  return { now, sys, tx, today, product };
}
type ScoutCtx = ReturnType<typeof scoutCtx>;

export function priceScoutUsecase(d: ScoutDeps) {
  const c = scoutCtx(d);
  return {
    ...configOps(c),
    scout: (who: PackWho, id: string) => scoutOnce(d, c, who, id),
    ...settingsOps(c),
  };
}
export type PriceScoutUsecase = ReturnType<typeof priceScoutUsecase>;

function configOps({ now, sys, tx, today, product }: ScoutCtx) {
  async function get(who: PackWho, id: string): Promise<PriceScoutProductOut> {
    const m = monthStart(await today(who));
    return tx(who, async (r) => {
      const p = await product(r, id);
      const defaults = groupDefaults(p.group_saved);
      return {
        product_id: id,
        group: p.group,
        override: p.override,
        defaults,
        effective: effectiveConfig(defaults, p.override),
        next_at: p.next_at,
        last_at: p.last_at,
        last_status: p.last_status,
        usage: usageOut(await r.usage(m), m, sys),
      };
    });
  }
  async function save(who: PackWho, id: string, o: PriceScoutOverride) {
    await tx(who, async (r) => {
      const p = await product(r, id);
      const eff = effectiveConfig(groupDefaults(p.group_saved), o);
      const next = nextScoutAt(eff, p.last_at ? new Date(p.last_at) : null, now());
      if (!(await r.saveOverride(id, o, next?.toISOString() ?? null)))
        throw new ScoutFail("not_found");
    });
    return get(who, id);
  }
  return { get, save };
}

async function scoutOnce(
  d: ScoutDeps,
  { sys, tx, today, product }: ScoutCtx,
  who: PackWho,
  id: string,
): Promise<SupplierSearchOut> {
  if (d.enabled && !(await d.enabled(who.tenantId))) throw new ScoutFail("disabled");
  const day = await today(who);
  const m = monthStart(day);
  const p = await tx(who, async (r) => {
    const x = await product(r, id);
    if (!(await r.reserveManual(day, m, sys))) throw new ScoutFail("month_cap");
    return x;
  });
  await d.quota(who.tenantId);
  const cfg = effectiveConfig(groupDefaults(p.group_saved), p.override);
  const out = await d.agent({
    tenantId: who.tenantId,
    userId: who.userId,
    productId: id,
    trigger: "manual",
    prompt: scoutPrompt(p.name, cfg),
    signal: AbortSignal.timeout(d.timeoutMs ?? SCOUT_TIMEOUT_MS),
  });
  // Không tới nhà cung cấp (agent tắt / hết trần token ngày) ⇒ trả lượt đã giữ; tới rồi ⇒ cộng token.
  const refund =
    !out.ok &&
    (out.code === "UNAVAILABLE" || out.code === "CAP_EXCEEDED" || out.code === "DISABLED");
  const tokens = out.ok ? out.tokens : 0;
  if (refund || tokens > 0) await tx(who, (r) => r.settleManual(day, tokens, refund));
  if (!out.ok) throw failOf(out.code);
  const items = parseSearchReply(out.text, day, cfg.exclude_sites);
  if (!items) throw new ScoutFail("failed");
  return { query: p.name, items: toExVat(items, cfg.vat) };
}

const NO_QUOTA: PriceScoutQuotaRow = {
  searches_month: null,
  tokens_month: null,
  platform_searches_month: null,
  platform_tokens_month: null,
};

function settingsOps({ now, sys, tx, today }: ScoutCtx) {
  async function defaults(who: PackWho): Promise<PriceScoutDefaultsOut> {
    const g = await tx(who, (r) => r.defaults());
    return {
      groups: { service: groupDefaults(g.service ?? {}), goods: groupDefaults(g.goods ?? {}) },
    };
  }
  async function quota(who: PackWho, canOverride: boolean): Promise<PriceScoutQuotaOut> {
    const m = monthStart(await today(who));
    const u = await tx(who, (r) => r.usage(m));
    return { ...(u.quota ?? NO_QUOTA), usage: usageOut(u, m, sys), can_override: canOverride };
  }
  return {
    defaults,
    quota,
    async saveDefaults(who: PackWho, group: PriceScoutGroup, c: PriceScoutConfig) {
      await tx(who, (r) => r.saveDefaults(group, c, now().toISOString()));
      return defaults(who);
    },
    async saveQuota(
      who: PackWho,
      q: PriceScoutQuotaRow,
      o: { writePlatform: boolean; canOverride: boolean },
    ) {
      await tx(who, (r) => r.saveQuota(q, o.writePlatform));
      return quota(who, o.canOverride);
    },
  };
}
