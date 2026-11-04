// CR-118 · UW-FR-04 · UW-FR-16..19 · D4 · read-model năng lực trên ConfigCache: `/pack/me` (lát cắt user) và capabilities
// theo tenant. Nóng = 0 SQL: quyền/feature/agent từ ảnh cache; khe + flow độc lập nạp lại một lần mỗi version Hub (2 câu
// cố định); brand (không bump version) giữ theo TTL. Thân đã dựng nhớ theo "tem" (version + brand + role) ⇒ 304 không dựng lại.
import {
  type ShellBrand,
  ShellMeResponseSchema,
  TenantCapabilitiesResponseSchema,
} from "@ai/contracts";
import type { ConfigCache } from "../config/config.service";
import { packAccessInput, tenantFeatureOn } from "../packs/kit/adapters/pack-guard.middleware";
import { externalPackActions } from "../packs/kit/domain/external-access.rules";
import { packActionsFor } from "../packs/kit/domain/pack-access.rules";
import type { HubExtras } from "./capabilities.repo";
import {
  addonKeysOf,
  type CapsInput,
  etagOf,
  installedPacks,
  type PackAction,
  shellMe,
  tenantCapabilities,
} from "./capabilities.rules";

export type CapsView = Pick<
  ConfigCache,
  "adminSettled" | "catalog" | "snapshot" | "user" | "tenant" | "versions"
>;
export type BrandRow = {
  name: string | null;
  appName: string | null;
  logo: string | null;
  accent: string | null;
};
export type ToolInfoLite = { key: string; sideEffect: boolean; action?: PackAction };
export type CapsDeps = {
  view: CapsView;
  loadExtras: () => Promise<HubExtras>;
  /** Brand công ty (1 câu, cổng gói contracts); vắng ⇒ null. */
  brand?: (tenantId: string) => Promise<BrandRow | null>;
  tools?: (pack: string) => readonly ToolInfoLite[];
  packAgents?: ReadonlyMap<string, readonly string[]>;
  brandTtlMs?: number;
  now?: () => number;
  /** Trần số thân nhớ (user + tenant); vượt ⇒ xoá sạch rồi dựng lại (đơn giản, đủ chặn bộ nhớ). */
  memoMax?: number;
};
export type Who = {
  userId: string;
  tenantId: string;
  role: string;
  userKind?: "internal" | "external";
};
export type Tagged = { etag: string; body: string };

const BRAND_TTL_MS = 60_000;
const MEMO_MAX = 20_000;
type BrandEntry = { at: number; brand: ShellBrand | null; gen: number };

export class CapabilitiesService {
  readonly #d: CapsDeps;
  #brands = new Map<string, BrandEntry>();
  #brandGen = 0;
  #extras: { hub: number; p: Promise<HubExtras> } | null = null;
  #memo = new Map<string, { stamp: string; out: Tagged }>();

  constructor(d: CapsDeps) {
    this.#d = d;
  }

  async shellMe(u: Who): Promise<Tagged> {
    await this.#d.view.adminSettled();
    const [cat, snap] = await Promise.all([this.#d.view.catalog(), this.#d.view.snapshot()]);
    const brand = await this.#brand(u.tenantId);
    const versions = { admin: cat.adminVersion, hub: snap.version };
    const user = await this.#d.view.user(u.userId);
    const external = u.userKind === "external" || user?.external === true;
    const stamp = `${versions.admin}.${versions.hub}.${brand.gen}.${u.role}.${external}`;
    const key = `u:${u.userId}:${u.tenantId}`;
    const hit = this.#memo.get(key);
    if (hit?.stamp === stamp) return hit.out;
    const packs = await Promise.all(
      installedPacks(cat.features).map(async (k) => {
        const i = await packAccessInput(this.#d.view, k, u);
        return { key: k, enabled: i.entitled && !i.featureOff, actions: packActionsFor(i) };
      }),
    );
    const addons = await this.#addons(cat.features, packs, u.tenantId);
    const body = ShellMeResponseSchema.parse(
      shellMe({
        versions,
        user: { id: u.userId, tenantId: u.tenantId, role: u.role, external },
        packs: orderHome(packs),
        addons,
        brand: brand.brand,
        externalPacks: new Set(
          packs.map((p) => p.key).filter((k) => externalPackActions(k).length > 0),
        ),
      }),
    );
    return this.#remember(key, stamp, versions, body);
  }

  async #addons(
    features: readonly { key: string }[],
    packs: readonly { key: string }[],
    tenantId: string,
  ) {
    const out: { pack: string; key: string; on: boolean }[] = [];
    for (const p of packs)
      for (const k of addonKeysOf(features as { id: string; key: string; status: string }[], p.key))
        out.push({ pack: p.key, key: k, on: await tenantFeatureOn(this.#d.view, k, tenantId) });
    return out;
  }

  /** null = tenant không có trong cache (404 ở route). */
  async tenantCapabilities(tenantId: string): Promise<Tagged | null> {
    await this.#d.view.adminSettled();
    if (!(await this.#d.view.tenant(tenantId))) return null;
    const [cat, snap] = await Promise.all([this.#d.view.catalog(), this.#d.view.snapshot()]);
    const extras = await this.#extrasFor(snap.version);
    const versions = { admin: cat.adminVersion, hub: snap.version };
    const stamp = `${versions.admin}.${versions.hub}`;
    const key = `t:${tenantId}`;
    const hit = this.#memo.get(key);
    if (hit?.stamp === stamp) return hit.out;
    const t = await this.#d.view.tenant(tenantId);
    const input: CapsInput = {
      tenantId,
      versions,
      features: cat.features,
      entitled: (fid) => cat.entitled.has(`${tenantId}:${fid}`),
      agents: snap.agents.map((a) => ({
        id: a.id,
        key: a.key,
        name: a.name.vi,
        enabled: a.enabled,
      })),
      entitledAgentIds: new Set(
        snap.entitlements
          .filter((e) => e.tenantId === tenantId && !e.revokedAt)
          .map((e) => e.agentId),
      ),
      packAgents: this.#d.packAgents ?? new Map(),
      tools: (p) =>
        (this.#d.tools?.(p) ?? []).map((x) => ({
          key: x.key,
          side_effect: x.sideEffect,
          action: x.action ?? "write",
        })),
      slots: extras.slots,
      standalone: extras.standalone,
      workflows: [...cat.workflows.values()].map((w) => ({
        id: w.id,
        key: w.key,
        name: w.name,
        enabled: w.enabled,
      })),
      agentWorkflows: snap.agentWorkflows,
      defaults: snap.tenantDefaults?.get(tenantId) ?? null,
      limits: t?.dailyLimits ?? null,
    };
    const body = TenantCapabilitiesResponseSchema.parse(tenantCapabilities(input));
    return this.#remember(key, stamp, versions, body);
  }

  #remember(key: string, stamp: string, v: { admin: number; hub: number }, body: unknown): Tagged {
    const json = JSON.stringify(body);
    const out = { etag: etagOf(v, json), body: json };
    if (this.#memo.size >= (this.#d.memoMax ?? MEMO_MAX)) this.#memo.clear();
    this.#memo.set(key, { stamp, out });
    return out;
  }

  /** Phần Hub ngoài ảnh: một lần nạp mỗi version Hub (single-flight); lỗi ⇒ bỏ cache để lần sau thử lại. */
  #extrasFor(hub: number): Promise<HubExtras> {
    if (this.#extras?.hub === hub) return this.#extras.p;
    const p = this.#d.loadExtras();
    this.#extras = { hub, p };
    p.catch(() => {
      if (this.#extras?.p === p) this.#extras = null;
    });
    return p;
  }

  async #brand(tenantId: string): Promise<BrandEntry> {
    const now = (this.#d.now ?? Date.now)();
    const hit = this.#brands.get(tenantId);
    if (hit && now - hit.at < (this.#d.brandTtlMs ?? BRAND_TTL_MS)) return hit;
    let brand: ShellBrand | null = hit?.brand ?? null;
    try {
      const r = (await this.#d.brand?.(tenantId)) ?? null;
      brand = r ? { name: r.name, app_name: r.appName, logo: r.logo, accent: r.accent } : null;
    } catch {
      // brand là trang trí: lỗi đọc ⇒ giữ bản cũ (hoặc null), không làm hỏng /pack/me
    }
    const same = hit && JSON.stringify(hit.brand) === JSON.stringify(brand);
    const e = { at: now, brand, gen: same && hit ? hit.gen : ++this.#brandGen };
    if (this.#brands.size >= (this.#d.memoMax ?? MEMO_MAX)) this.#brands.clear();
    this.#brands.set(tenantId, e);
    return e;
  }
}

/** contracts trước community (trang chủ), còn lại theo khoá. */
const orderHome = <T extends { key: string }>(packs: T[]): T[] =>
  [...packs].sort((a, b) => rank(a.key) - rank(b.key) || (a.key < b.key ? -1 : 1));
const rank = (k: string) => (k === "contracts" ? 0 : k === "community" ? 1 : 2);
