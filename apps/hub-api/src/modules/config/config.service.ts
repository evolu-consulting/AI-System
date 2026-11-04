// HUB-FR-02, HUB-FR-03, HUB-BR-06 · cache cấu hình `admin` + `hub` của một instance (plan H1 §4 Cache, spec H1-R04, R15).
// Nạp lại: LISTEN `config_changed` (không có tenant_id ⇒ nạp lại toàn bộ phần admin) + `hub_config_changed` + `profile_changed`
// (chỉ lát tenant/user, cr118-r1-fixes), và poll
// `config_version`/`hub_config_version` mỗi `pollS` giây (lưới an toàn khi mất NOTIFY). Admin chết ⇒ giữ cache cũ.
import {
  CONFIG_CHANNEL,
  ConfigChangedPayloadSchema,
  PROFILE_CHANNEL,
  ProfileChangedPayloadSchema,
} from "@ai/contracts";
import { HUB_CONFIG_CHANNEL, HubConfigChangedPayloadSchema } from "@ai/contracts/hub";
import type { Db } from "../../lib/db";
import { safeErrorFields } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import { loadCatalogRows } from "./catalog.repo";
import { buildCatalog, type CatalogRows, type CatalogSnapshot } from "./catalog.rules";
import { type Coalesced, coalesce } from "./coalesce";
import {
  loadHubSnapshot,
  loadTenants,
  loadUsers,
  readVersions,
  type Versions,
} from "./config.repo";
import {
  accountUsable,
  type ConfigSnapshot,
  type OrchestratorProblem,
  orchestratorProblem,
  type TenantState,
  type UserState,
} from "./config.rules";
import { refreshHubSchemaCaps } from "./schema-caps";

/** Nguồn dữ liệu của cache — tách khỏi `Db` để unit test thay bằng giả. */
export type ConfigSource = {
  readVersions(): Promise<Versions>;
  loadHub(): Promise<ConfigSnapshot>;
  loadTenants(): Promise<TenantState[]>;
  loadUsers(ids: readonly string[]): Promise<UserState[]>;
  /** Catalog Admin H2a (P5, P14); nạp cùng phần Admin. */
  loadCatalog(adminVersion: number): Promise<CatalogRows>;
  listen(channel: string, onPayload: (payload: string) => void): Promise<() => Promise<void>>;
  /** cr118-schema-caps-prod · đầu mỗi lần nạp: còn thiếu schema tuỳ chọn ⇒ dò lại (đủ ⇒ 0 SQL). */
  refreshSchema?(): Promise<void>;
};

export function dbConfigSource(db: Db): ConfigSource {
  return {
    readVersions: () => readVersions(db),
    loadHub: () => loadHubSnapshot(db),
    loadTenants: () => loadTenants(db),
    loadUsers: (ids) => loadUsers(db, ids),
    loadCatalog: (v) => loadCatalogRows(db, v),
    listen: (channel, fn) => db.listen(channel, fn),
    refreshSchema: async () => {
      await refreshHubSchemaCaps(db);
    },
  };
}

type Waiter = { min: number; done: (v: number) => void };
/** CR-118 N3 · ảnh vừa đổi: `tenants` = tenant bị chạm (theo `tenant_id` của NOTIFY); null = mọi tenant (poll/hub/không rõ). */
export type ConfigChange = { admin: number; hub: number; tenants: ReadonlySet<string> | null };
export type ConfigCacheOptions = { pollS: number; log: Logger; signal?: AbortSignal };

export class ConfigCache {
  readonly #src: ConfigSource;
  readonly #opts: ConfigCacheOptions;
  #hub: ConfigSnapshot | null = null;
  #adminVersion = -1;
  /** Tăng mỗi lần bắt đầu nạp Admin: `user()` chỉ cache khi không có lần nạp nào xen giữa (tránh ghi đè dữ liệu mới). */
  #adminGen = 0;
  #tenants = new Map<string, TenantState>();
  #users = new Map<string, UserState>();
  #catalog: CatalogSnapshot | null = null;
  #unlisten: (() => Promise<void>)[] = [];
  #subscribing = false;
  #timer: ReturnType<typeof setInterval> | null = null;
  #stopped = false;
  #polling: Promise<void> | null = null;
  #queuedPoll: Promise<void> | null = null;
  /** Người chờ `reloaded()`: resolve khi một lần `#loadAdmin` xong với version ≥ `min`. */
  #waiters: Waiter[] = [];
  /** CR-118 N3 · người nghe "ảnh đã đổi" (đẩy `config.changed` qua `/me/stream`). */
  readonly #listeners = new Set<(c: ConfigChange) => void>();
  /** Tenant bị chạm từ NOTIFY `config_changed` chờ lần nạp Admin kế; "all" = không rõ ⇒ mọi tenant. */
  #pendingTenants: Set<string> | "all" = new Set();
  /** `profile_version` đã nạp (-1 = chưa); lượt kế cần nạp ĐẦY ĐỦ (catalog) hay chỉ lát profile. */
  #profileVersion = -1;
  #fullWanted = false;
  readonly reloadHub: () => Promise<void>;
  readonly reloadAdmin: () => Promise<void>;
  readonly #adminRun: Coalesced;

  constructor(src: ConfigSource, opts: ConfigCacheOptions) {
    this.#src = src;
    this.#opts = opts;
    this.reloadHub = coalesce(async () => {
      const prev = this.#hub?.version;
      await this.#src.refreshSchema?.();
      this.#hub = await this.#src.loadHub();
      if (prev !== undefined && prev !== this.#hub.version) this.#emit(null);
    });
    this.#adminRun = coalesce(() => this.#loadAdmin());
    this.reloadAdmin = () => {
      this.#fullWanted = true;
      return this.#adminRun();
    };
  }

  /**
   * N1 T5b · lần nạp Admin ĐANG chạy (vd vừa nhận `config_changed`) xong — không kích hoạt nạp mới, không có thì resolve
   * ngay (0 SQL). Quyền gói chờ nó để thấy thay đổi đã NOTIFY trước request (lỗi nạp: giữ cache cũ, không ném).
   */
  adminSettled(): Promise<void> {
    const run = this.#adminRun.current();
    return run ? run.catch(() => undefined) : Promise.resolve();
  }

  /** Bắt đầu vòng nền (nạp đầu, LISTEN, poll). Dừng khi `signal` abort. */
  start(): void {
    const { signal } = this.#opts;
    if (signal?.aborted) return;
    signal?.addEventListener("abort", () => void this.stop(), { once: true });
    this.ready().catch((err) => this.#opts.log.error("config-load-failed", safeErrorFields(err)));
    void this.#subscribe();
    this.#timer = setInterval(() => void this.poll(), this.#opts.pollS * 1000);
    // Không giữ tiến trình sống chỉ vì vòng poll (test dừng app bằng `db.close()` không abort).
    this.#timer.unref?.();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#settleWaiters(Number.POSITIVE_INFINITY);
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    const subs = this.#unlisten;
    this.#unlisten = [];
    await Promise.allSettled(subs.map((u) => u()));
  }

  /** Đảm bảo đã nạp ít nhất một lần (lần đầu lỗi ⇒ thử lại ở lần gọi sau). */
  async ready(): Promise<void> {
    await Promise.all([
      this.#hub ? undefined : this.reloadHub(),
      this.#adminVersion >= 0 ? undefined : this.reloadAdmin(),
    ]);
  }

  /** Ảnh cấu hình Hub hiện hành — run chụp lúc bắt đầu và giữ tới hết (HUB-BR-06). */
  async snapshot(): Promise<ConfigSnapshot> {
    if (!this.#hub) await this.reloadHub();
    if (!this.#hub) throw new Error("config snapshot unavailable");
    return this.#hub;
  }

  async tenant(id: string): Promise<TenantState | undefined> {
    await this.ready();
    return this.#tenants.get(id);
  }

  /** User chưa có trong cache ⇒ đọc DB rồi cache (plan §4: "user lạ → đọc rồi cache"). */
  async user(id: string): Promise<UserState | undefined> {
    await this.ready();
    const hit = this.#users.get(id);
    if (hit) return hit;
    const gen = this.#adminGen;
    const [u] = await this.#src.loadUsers([id]);
    if (u && gen === this.#adminGen && !this.#users.has(id)) this.#users.set(id, u);
    return u;
  }

  /** Catalog Admin hiện hành (H2a §4) — bất biến; menu/`prepare` chụp một lần mỗi request (HUB-BR-06). */
  async catalog(): Promise<CatalogSnapshot> {
    if (!this.#catalog) await this.reloadAdmin();
    if (!this.#catalog) throw new Error("catalog snapshot unavailable");
    return this.#catalog;
  }

  /** H1-R04 theo cache: tenant hoạt động, user hoạt động, không bị tenant khoá, đúng tenant. */
  async accountUsable(tenantId: string, userId: string): Promise<boolean> {
    const [t, u] = await Promise.all([this.tenant(tenantId), this.user(userId)]);
    return accountUsable(t, u);
  }

  /**
   * Một vòng poll: so phiên bản, khác thì nạp lại phần tương ứng; LISTEN hỏng thì đăng ký lại. Single-flight (X2b
   * review-1 #3): tối đa một vòng đang chạy + một vòng chờ; người gọi giữa chừng nhận vòng **chờ** (bắt đầu sau khi họ
   * gọi ⇒ vẫn thấy thay đổi đã COMMIT trước đó, AC14).
   */
  poll(): Promise<void> {
    if (!this.#polling) return this.#startPoll();
    this.#queuedPoll ??= this.#polling.then(() => {
      this.#queuedPoll = null;
      return this.#startPoll();
    });
    return this.#queuedPoll;
  }

  #startPoll(): Promise<void> {
    const p: Promise<void> = this.#pollOnce().finally(() => {
      if (this.#polling === p) this.#polling = null;
    });
    this.#polling = p;
    return p;
  }

  async #pollOnce(): Promise<void> {
    if (this.#stopped) return;
    try {
      if (this.#unlisten.length === 0) await this.#subscribe();
      const v = await this.#src.readVersions();
      const jobs: Promise<void>[] = [];
      if (v.hub !== (this.#hub?.version ?? -1)) jobs.push(this.reloadHub());
      if (v.admin !== this.#adminVersion) jobs.push(this.reloadAdmin());
      else if ((v.profile ?? 0) !== this.#profileVersion && this.#profileVersion >= 0)
        jobs.push(this.#adminRun());
      await Promise.all(jobs);
    } catch (err) {
      if (!this.#stopped) this.#opts.log.warn("config-poll-failed", safeErrorFields(err));
    }
  }

  /** CR-118 · cặp version hiện có (0 SQL; -1 = chưa nạp). */
  versions(): { admin: number; hub: number } {
    return { admin: this.#adminVersion, hub: this.#hub?.version ?? -1 };
  }

  /** CR-118 N3 · nghe ảnh đổi (sau khi nạp xong, version khác lần trước). Trả hàm huỷ. Lỗi người nghe không lan. */
  onChange(fn: (c: ConfigChange) => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #emit(tenants: ReadonlySet<string> | null): void {
    if (this.#listeners.size === 0) return;
    const c: ConfigChange = { ...this.versions(), tenants };
    for (const fn of this.#listeners) {
      try {
        fn(c);
      } catch (err) {
        this.#opts.log.warn("config-change-listener-failed", safeErrorFields(err));
      }
    }
  }

  /**
   * Một lượt của vòng nạp Admin (coalesce ⇒ không bao giờ chạy chồng, kể cả lát profile). Version Admin đổi / được yêu cầu
   * đầy đủ ⇒ nạp đầy đủ; không thì chỉ lát tenant/user (cr118-r1-fixes #3). Tenant chạm từ NOTIFY luôn được phát, kể cả khi
   * version không đổi (cr118-r1-fixes #1: NOTIFY tới giữa hai lần nạp gộp mà lần trước đã thấy version mới).
   */
  async #loadAdmin(): Promise<void> {
    this.#adminGen++;
    const prevVersion = this.#adminVersion;
    const prevProfile = this.#profileVersion;
    let full = this.#fullWanted || prevVersion < 0;
    this.#fullWanted = false;
    const touched = this.#pendingTenants;
    this.#pendingTenants = new Set();
    await this.#src.refreshSchema?.();
    // Đọc phiên bản TRƯỚC dữ liệu: thay đổi xen giữa làm phiên bản mới hơn ⇒ vòng poll sau nạp lại, không bỏ sót.
    const v = await this.#src.readVersions();
    const { admin } = v;
    if (admin !== prevVersion) full = true;
    if (full) await this.#loadFull(admin);
    else await this.#loadProfile(touched);
    this.#profileVersion = v.profile ?? 0;
    this.#adminVersion = admin;
    this.#settleWaiters(admin);
    if (prevVersion < 0) return;
    const someTouched = touched === "all" || touched.size > 0;
    if (someTouched || prevVersion !== admin || prevProfile !== this.#profileVersion)
      this.#emit(touched === "all" || touched.size === 0 ? null : touched);
  }

  async #loadFull(admin: number): Promise<void> {
    const tenants = await this.#src.loadTenants();
    const users = await this.#src.loadUsers([...this.#users.keys()]);
    const { catalog, dropped } = buildCatalog(await this.#src.loadCatalog(admin));
    if (dropped.length > 0) this.#opts.log.warn("catalog-rows-dropped", { dropped });
    this.#catalog = catalog;
    this.#tenants = new Map(tenants.map((t) => [t.id, t]));
    this.#users = new Map(users.map((u) => [u.id, u]));
  }

  /** Lát profile: tenants + user đã cache của tenant bị chạm ("all"/rỗng = mọi user đã cache); không catalog. */
  async #loadProfile(touched: Set<string> | "all"): Promise<void> {
    const all = touched === "all" || touched.size === 0;
    const ids = [...this.#users.values()]
      .filter((u) => all || touched.has(u.tenantId))
      .map((u) => u.id);
    const tenants = await this.#src.loadTenants();
    const users = ids.length > 0 ? await this.#src.loadUsers(ids) : [];
    this.#tenants = new Map(tenants.map((t) => [t.id, t]));
    const next = new Map(this.#users);
    for (const id of ids) next.delete(id);
    for (const u of users) next.set(u.id, u);
    this.#users = next;
  }

  /**
   * N1 T5b (readiness #6) · tín hiệu "đã nạp lại phần Admin": resolve version khi một lần nạp Admin XONG với version ≥
   * `minAdminVersion` (đã đạt ⇒ resolve ngay). Vắng tham số ⇒ chờ lần nạp kế tiếp. Không kích hoạt nạp, không đổi hành vi
   * nạp lại; `stop()` ⇒ resolve version hiện có (không treo người chờ).
   */
  reloaded(minAdminVersion?: number): Promise<number> {
    if (minAdminVersion !== undefined && this.#adminVersion >= minAdminVersion)
      return Promise.resolve(this.#adminVersion);
    if (this.#stopped) return Promise.resolve(this.#adminVersion);
    const min = minAdminVersion ?? Number.NEGATIVE_INFINITY;
    return new Promise((done) => this.#waiters.push({ min, done }));
  }

  /** `version` = vừa nạp xong (vô cực = dừng: trả mọi người chờ về version hiện có). */
  #settleWaiters(version: number): void {
    if (this.#waiters.length === 0) return;
    const keep: Waiter[] = [];
    for (const w of this.#waiters) {
      if (version >= w.min) w.done(Number.isFinite(version) ? version : this.#adminVersion);
      else keep.push(w);
    }
    this.#waiters = keep;
  }

  #onAdminChanged = (payload: string): void => {
    const p = ConfigChangedPayloadSchema.safeParse(safeJson(payload));
    if (!p.success) this.#opts.log.warn("config-changed-invalid-payload");
    const tid = p.success ? p.data.tenant_id : undefined;
    if (tid && this.#pendingTenants !== "all") this.#pendingTenants.add(tid);
    else this.#pendingTenants = "all";
    this.reloadAdmin().catch((err) =>
      this.#opts.log.warn("config-reload-failed", safeErrorFields(err)),
    );
  };

  /** cr118-r1-fixes #3 · default_app/brand của MỘT tenant: chỉ nạp lát profile (không catalog), không ép nạp đầy đủ. */
  #onProfileChanged = (payload: string): void => {
    const p = ProfileChangedPayloadSchema.safeParse(safeJson(payload));
    if (!p.success) this.#opts.log.warn("profile-changed-invalid-payload");
    if (p.success && this.#pendingTenants !== "all") this.#pendingTenants.add(p.data.tenant_id);
    else this.#pendingTenants = "all";
    this.#adminRun().catch((err) =>
      this.#opts.log.warn("config-reload-failed", safeErrorFields(err)),
    );
  };

  #onHubChanged = (payload: string): void => {
    const p = HubConfigChangedPayloadSchema.safeParse(safeJson(payload));
    if (!p.success) this.#opts.log.warn("hub-config-changed-invalid-payload");
    else if (this.#hub && p.data.version <= this.#hub.version) return;
    this.reloadHub().catch((err) =>
      this.#opts.log.warn("hub-config-reload-failed", safeErrorFields(err)),
    );
  };

  async #subscribe(): Promise<void> {
    if (this.#subscribing || this.#stopped) return;
    this.#subscribing = true;
    const subs: (() => Promise<void>)[] = [];
    try {
      subs.push(await this.#src.listen(CONFIG_CHANNEL, this.#onAdminChanged));
      subs.push(await this.#src.listen(HUB_CONFIG_CHANNEL, this.#onHubChanged));
      subs.push(await this.#src.listen(PROFILE_CHANNEL, this.#onProfileChanged));
      this.#unlisten = subs;
      if (this.#stopped) await this.stop();
    } catch (err) {
      await Promise.allSettled(subs.map((u) => u()));
      if (!this.#stopped) this.#opts.log.warn("config-listen-failed", safeErrorFields(err));
    } finally {
      this.#subscribing = false;
    }
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Dựng cache trên `db` (role hub_api) và chạy vòng nền ngay (QW-A2: không cần gọi thêm hàm). */
export function startConfigCache(db: Db, opts: ConfigCacheOptions): ConfigCache {
  const cache = new ConfigCache(dbConfigSource(db), opts);
  cache.start();
  return cache;
}

/** HUB-BR-08 lúc khởi động (`server.ts`, A46): null = Orchestrator hợp lệ. */
export async function bootOrchestratorProblem(db: Db): Promise<OrchestratorProblem | null> {
  return orchestratorProblem(await loadHubSnapshot(db));
}
