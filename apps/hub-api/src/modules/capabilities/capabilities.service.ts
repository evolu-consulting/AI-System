// CR-118 · UW-FR-04 · UW-FR-16..19 · D4 · read-model năng lực trên ConfigCache: `/pack/me` (lát cắt user) và capabilities
// theo tenant. Nóng = 0 SQL: quyền/feature/agent từ ảnh cache; khe + flow độc lập nạp lại một lần mỗi version Hub (2 câu
// cố định); brand nhớ tới khi `onChange` báo tenant bị chạm (đổi brand bump `config_version` — cr118-config-consistency). Thân đã dựng nhớ theo "tem" (version + brand + role) ⇒ 304 không dựng lại.
import {
  type ShellBrand,
  ShellMeResponseSchema,
  TenantCapabilitiesResponseSchema,
} from "@ai/contracts/capabilities";
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
  /** Phần Hub ngoài ảnh của MỘT tenant (lọc trong SQL, cr118-r1-fixes #2). */
  loadExtras: (tenantId: string) => Promise<HubExtras>;
  /** Brand công ty (1 câu, cổng gói contracts); vắng ⇒ null. */
  brand?: (tenantId: string) => Promise<BrandRow | null>;
  tools?: (pack: string) => readonly ToolInfoLite[];
  /** ConfigCache `onChange`: tenant bị chạm (brand, default_app…) ⇒ bỏ brand đã nhớ của tenant đó. */
  onChange?: (fn: (c: { tenants: ReadonlySet<string> | null }) => void) => () => void;
  /** Trần số thân nhớ (user + tenant); vượt ⇒ xoá sạch rồi dựng lại (đơn giản, đủ chặn bộ nhớ). */
  memoMax?: number;
  /** Cờ flow runtime (hằng theo tiến trình, đọc từ env một lần ở mount); vắng ⇒ tắt. */
  flowRuntime?: boolean;
};
export type Who = {
  userId: string;
  tenantId: string;
  role: string;
  userKind?: "internal" | "external";
};
export type Tagged = { etag: string; body: string };

const MEMO_MAX = 20_000;
type BrandEntry = { brand: ShellBrand | null; gen: number };

export class CapabilitiesService {
  readonly #d: CapsDeps;
  #brands = new Map<string, BrandEntry>();
  #brandGen = 0;
  #brandEpoch = 0;
  /** Phần Hub theo tenant, cùng một version Hub (đổi version ⇒ bỏ hết). */
  #extras: { hub: number; byTenant: Map<string, Promise<HubExtras>> } = {
    hub: -1,
    byTenant: new Map(),
  };
  #memo = new Map<string, { stamp: string; out: Tagged }>();
  /** Huỷ đăng ký `onChange` (vòng đời = app; test gọi để dọn). */
  readonly close: () => void;

  constructor(d: CapsDeps) {
    this.#d = d;
    this.close = d.onChange?.((c) => this.#invalidate(c.tenants)) ?? (() => {});
  }

  async shellMe(u: Who): Promise<Tagged> {
    await this.#d.view.adminSettled();
    const [cat, snap] = await Promise.all([this.#d.view.catalog(), this.#d.view.snapshot()]);
    const brand = await this.#brand(u.tenantId);
    const versions = { admin: cat.adminVersion, hub: snap.version };
    const user = await this.#d.view.user(u.userId);
    const external = u.userKind === "external" || user?.external === true;
    const defaultApp = {
      user: user?.defaultApp ?? null,
      tenant: (await this.#d.view.tenant(u.tenantId))?.defaultApp ?? null,
    };
    // default_app đổi không bump version Admin (cr118-r1-fixes #3) ⇒ nằm trong tem
    const stamp = `${versions.admin}.${versions.hub}.${brand.gen}.${u.role}.${external}.${defaultApp.user}.${defaultApp.tenant}`;
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
        defaultApp,
        flowRuntime: this.#d.flowRuntime === true,
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
    const extras = await this.#extrasFor(snap.version, tenantId);
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
      packAgents: snap.packAgents ?? new Map(),
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

  /** Phần Hub ngoài ảnh: một lần nạp mỗi (version Hub, tenant) (single-flight); lỗi ⇒ bỏ cache để lần sau thử lại. */
  #extrasFor(hub: number, tenantId: string): Promise<HubExtras> {
    if (this.#extras.hub !== hub) this.#extras = { hub, byTenant: new Map() };
    const m = this.#extras.byTenant;
    const hit = m.get(tenantId);
    if (hit) return hit;
    const p = this.#d.loadExtras(tenantId);
    if (m.size >= (this.#d.memoMax ?? MEMO_MAX)) m.clear();
    m.set(tenantId, p);
    p.catch(() => {
      if (m.get(tenantId) === p) m.delete(tenantId);
    });
    return p;
  }

  /** Ảnh cấu hình đổi (brand/default_app bump `config_version` kèm `tenant_id`) ⇒ bỏ brand của tenant bị chạm; null = mọi tenant. */
  #invalidate(tenants: ReadonlySet<string> | null): void {
    this.#brandEpoch++;
    if (tenants === null) this.#brands.clear();
    else for (const t of tenants) this.#brands.delete(t);
  }

  /** Không TTL: giữ tới khi `onChange` báo tenant bị chạm. Lỗi đọc ⇒ không nhớ (lần sau thử lại), trả bản cũ hoặc null. */
  async #brand(tenantId: string): Promise<BrandEntry> {
    const hit = this.#brands.get(tenantId);
    if (hit) return hit;
    const epoch = this.#brandEpoch;
    let brand: ShellBrand | null;
    try {
      const r = (await this.#d.brand?.(tenantId)) ?? null;
      brand = r ? { name: r.name, app_name: r.appName, logo: r.logo, accent: r.accent } : null;
    } catch {
      return { brand: null, gen: 0 }; // brand là trang trí: lỗi đọc không làm hỏng /pack/me
    }
    const e = { brand, gen: ++this.#brandGen };
    // đổi xen giữa lúc đọc ⇒ không nhớ bản có thể cũ
    if (epoch !== this.#brandEpoch) return e;
    if (this.#brands.size >= (this.#d.memoMax ?? MEMO_MAX)) this.#brands.clear();
    this.#brands.set(tenantId, e);
    return e;
  }
}

/** contracts trước community (trang chủ), còn lại theo khoá. */
const orderHome = <T extends { key: string }>(packs: T[]): T[] =>
  [...packs].sort((a, b) => rank(a.key) - rank(b.key) || (a.key < b.key ? -1 : 1));
const rank = (k: string) => (k === "contracts" ? 0 : k === "community" ? 1 : 2);
