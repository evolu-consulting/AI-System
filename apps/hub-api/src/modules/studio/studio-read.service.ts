// HUB-FR-72 · HUB-FR-90 · H4a-R02, R13 · plan §5.4 · `me` + 5 catalog đọc của Studio. Mỗi request một transaction
// REPEATABLE READ read only (scope `system`, P6) ⇒ item và `hub_config_version` cùng một ảnh.
import type { Me } from "@ai/contracts/studio";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../lib/auth.middleware";
import type { Db } from "../../lib/db";
import { appError } from "../../lib/errors";
import { toList, toProviderItem, usableFor } from "./studio-read.map";
import {
  readAgentTypes,
  readEnabledWorkflows,
  readHubVersion,
  readMeRow,
  readModelProfiles,
  readProviders,
  readTenants,
} from "./studio-read.repo";

export type CatalogQuery = { q?: string; limit: number };

export class StudioReadService {
  constructor(private readonly deps: { db: Db }) {}

  #read<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withHubScope(this.deps.db, { kind: "system" }, fn, {
      isolationLevel: "repeatable read",
      accessMode: "read only",
    });
  }

  /** User đã qua `requireAuth` (cache: tồn tại, hoạt động) nhưng xoá giữa chừng ⇒ 401 như token hỏng. */
  me(user: AuthUser): Promise<Me> {
    return this.#read(async (tx) => {
      const row = await readMeRow(tx, user.userId);
      if (!row) throw appError("AUTH_EXPIRED");
      return {
        user_id: user.userId,
        tenant_id: user.tenantId,
        tenant_key: row.tenantKey,
        username: row.username,
        display_name: row.displayName,
        role: "platform_admin",
        hub_config_version: await readHubVersion(tx),
      };
    });
  }

  agentTypes(q: CatalogQuery) {
    return this.#read(async (tx) => {
      const rows = (await readAgentTypes(tx)).map((r) => ({
        key: r.key,
        runtime: r.runtime,
        description: r.description,
        config_schema: r.configSchema,
        version: r.version,
        available: r.available,
      }));
      const text = (r: (typeof rows)[number]) => [r.key, r.description.vi, r.description.en];
      return toList(rows, { ...q, version: await readHubVersion(tx), text });
    });
  }

  modelProfiles(q: CatalogQuery) {
    return this.#read(async (tx) => {
      const rows = (await readModelProfiles(tx)).map((r) => ({
        id: r.id,
        key: r.key,
        steps: r.steps.map((s) => ({ provider_key: s.provider_key, model: s.model, on: s.on })),
      }));
      return toList(rows, { ...q, version: await readHubVersion(tx), text: (r) => [r.key] });
    });
  }

  providers(q: CatalogQuery) {
    return this.#read(async (tx) => {
      const rows = (await readProviders(tx)).map(toProviderItem);
      const text = (r: (typeof rows)[number]) => [r.key, r.vendor, r.kind];
      return toList(rows, { ...q, version: await readHubVersion(tx), text });
    });
  }

  workflows(q: CatalogQuery & { app_type?: string }) {
    return this.#read(async (tx) => {
      const rows = (await readEnabledWorkflows(tx))
        .filter((r) => q.app_type === undefined || r.appType === q.app_type)
        .map((r) => ({
          id: r.id,
          key: r.key,
          name: r.name,
          description: r.description,
          app_type: r.appType,
          usable_for: usableFor(r.appType, r.inputSchema),
        }));
      const text = (r: (typeof rows)[number]) => [r.key, r.name];
      return toList(rows, { ...q, version: await readHubVersion(tx), text });
    });
  }

  tenants(q: CatalogQuery) {
    return this.#read(async (tx) => {
      const rows = (await readTenants(tx)).map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        active: r.active,
        has_orchestrator: r.hasOrchestrator,
      }));
      const text = (r: (typeof rows)[number]) => [r.key, r.name];
      return toList(rows, { ...q, version: await readHubVersion(tx), text });
    });
  }
}
