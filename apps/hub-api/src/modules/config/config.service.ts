// HUB-FR-02, HUB-FR-03, HUB-BR-06 · cache cấu hình `admin` + `hub` của một instance (plan H1 §4 Cache, spec H1-R04, R15).
// Nạp lại: LISTEN `config_changed` (không có tenant_id ⇒ nạp lại toàn bộ phần admin) + `hub_config_changed`, và poll
// `config_version`/`hub_config_version` mỗi `pollS` giây (lưới an toàn khi mất NOTIFY). Admin chết ⇒ giữ cache cũ.
import { CONFIG_CHANNEL, ConfigChangedPayloadSchema } from "@ai/contracts";
import { HUB_CONFIG_CHANNEL, HubConfigChangedPayloadSchema } from "@ai/contracts/hub";
import type { Db } from "../../lib/db";
import { safeErrorFields } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import { loadCatalogRows } from "./catalog.repo";
import { buildCatalog, type CatalogRows, type CatalogSnapshot } from "./catalog.rules";
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

/** Nguồn dữ liệu của cache — tách khỏi `Db` để unit test thay bằng giả. */
export type ConfigSource = {
  readVersions(): Promise<Versions>;
  loadHub(): Promise<ConfigSnapshot>;
  loadTenants(): Promise<TenantState[]>;
  loadUsers(ids: readonly string[]): Promise<UserState[]>;
  /** Catalog Admin H2a (P5, P14); nạp cùng phần Admin. */
  loadCatalog(adminVersion: number): Promise<CatalogRows>;
  listen(channel: string, onPayload: (payload: string) => void): Promise<() => Promise<void>>;
};

export function dbConfigSource(db: Db): ConfigSource {
  return {
    readVersions: () => readVersions(db),
    loadHub: () => loadHubSnapshot(db),
    loadTenants: () => loadTenants(db),
    loadUsers: (ids) => loadUsers(db, ids),
    loadCatalog: (v) => loadCatalogRows(db, v),
    listen: (channel, fn) => db.listen(channel, fn),
  };
}

export type ConfigCacheOptions = { pollS: number; log: Logger; signal?: AbortSignal };

/** Gộp các lần gọi chồng nhau: đang chạy thì đánh dấu chạy lại một lần nữa sau khi xong. */
function coalesce(fn: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null;
  let again = false;
  return () => {
    if (running) {
      again = true;
      return running;
    }
    const loop = async (): Promise<void> => {
      do {
        again = false;
        await fn();
      } while (again);
    };
    running = loop().finally(() => {
      running = null;
    });
    return running;
  };
}

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
  readonly reloadHub: () => Promise<void>;
  readonly reloadAdmin: () => Promise<void>;

  constructor(src: ConfigSource, opts: ConfigCacheOptions) {
    this.#src = src;
    this.#opts = opts;
    this.reloadHub = coalesce(async () => {
      this.#hub = await this.#src.loadHub();
    });
    this.reloadAdmin = coalesce(() => this.#loadAdmin());
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

  /** Một vòng poll: so phiên bản, khác thì nạp lại phần tương ứng; LISTEN hỏng thì đăng ký lại. */
  async poll(): Promise<void> {
    if (this.#stopped) return;
    try {
      if (this.#unlisten.length === 0) await this.#subscribe();
      const v = await this.#src.readVersions();
      const jobs: Promise<void>[] = [];
      if (v.hub !== (this.#hub?.version ?? -1)) jobs.push(this.reloadHub());
      if (v.admin !== this.#adminVersion) jobs.push(this.reloadAdmin());
      await Promise.all(jobs);
    } catch (err) {
      if (!this.#stopped) this.#opts.log.warn("config-poll-failed", safeErrorFields(err));
    }
  }

  async #loadAdmin(): Promise<void> {
    this.#adminGen++;
    // Đọc phiên bản TRƯỚC dữ liệu: thay đổi xen giữa làm phiên bản mới hơn ⇒ vòng poll sau nạp lại, không bỏ sót.
    const { admin } = await this.#src.readVersions();
    const tenants = await this.#src.loadTenants();
    const users = await this.#src.loadUsers([...this.#users.keys()]);
    const { catalog, dropped } = buildCatalog(await this.#src.loadCatalog(admin));
    if (dropped.length > 0) this.#opts.log.warn("catalog-rows-dropped", { dropped });
    this.#catalog = catalog;
    this.#tenants = new Map(tenants.map((t) => [t.id, t]));
    this.#users = new Map(users.map((u) => [u.id, u]));
    this.#adminVersion = admin;
  }

  #onAdminChanged = (payload: string): void => {
    if (!ConfigChangedPayloadSchema.safeParse(safeJson(payload)).success)
      this.#opts.log.warn("config-changed-invalid-payload");
    this.reloadAdmin().catch((err) =>
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
