// HUB-FR-120 · ADM-FR-68 · PB-R01/R02/R08/R10/R21 · C1/C7/C10/C11 · nghiệp vụ CRUD `/admin/sources`. Mọi ghi trong tx
// `system` (repo lọc tenant); quyền local_path = platform_admin; ẩn path cho non-platform; library kiểm kho H2c cùng tenant.
import type {
  LibraryDocListResponse,
  ProcessSourceChip,
  SourceConfig,
  SourceCreateRequest,
  SourceListResponse,
  SourceUpdateRequest,
  SourceView,
} from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../lib/auth.middleware";
import type { Db } from "../../lib/db";
import {
  assertVersion,
  decodeCursor,
  encodeCursor,
  gitHostAllowed,
  isPlatform,
  publicConfig,
  publicPin,
  readTenant,
  writeTenant,
} from "./source.rules";
import { sourceError } from "./sources.errors";
import * as repo from "./sources.repo";

/** Cursor picker library: base64url của `[name, id]`. */
function encodeDocCursor(key: [string, string]): string {
  return Buffer.from(JSON.stringify(key), "utf8").toString("base64url");
}
function decodeDocCursor(raw: string | undefined): [string, string] | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (Array.isArray(v) && typeof v[0] === "string" && typeof v[1] === "string")
      return [v[0], v[1]];
  } catch {
    // cursor hỏng ⇒ bỏ (trang đầu)
  }
  return undefined;
}

const toView = (r: repo.SourceRow, usedBy: string[], platform: boolean): SourceView => ({
  id: r.id,
  tenant_id: r.tenant_id,
  key: r.key,
  kind: r.kind,
  config: publicConfig(r.config, platform),
  description: r.description,
  version: r.version,
  used_by: usedBy,
  last_pin: publicPin(r.last_pin, platform),
  created_at: r.created_at,
  updated_at: r.updated_at,
  updated_by: r.updated_by,
});

export class SourcesService {
  constructor(private readonly db: Db) {}

  #system<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withHubScope(this.db, { kind: "system" }, fn);
  }

  /** Kiểm config theo loại: git host allowlist (422), library tồn tại cùng tenant (422 không rò). */
  async #checkConfig(tx: Tx, tenantId: string, config: SourceConfig): Promise<void> {
    if (config.kind === "git_remote" && !gitHostAllowed(config.url))
      throw sourceError("SOURCE_HOST_NOT_ALLOWED");
    if (
      config.kind === "library" &&
      !(await repo.libraryDocExists(tx, tenantId, config.document_id))
    )
      throw sourceError("SOURCE_UNRESOLVABLE");
  }

  async create(u: AuthUser, body: SourceCreateRequest): Promise<SourceView> {
    // local_path chỉ platform_admin (PB-R21) — kiểm trước mọi DB.
    if (body.kind === "local_path" && !isPlatform(u)) throw sourceError("SOURCE_FORBIDDEN_KIND");
    const tenantId = writeTenant(u, body.tenant_id);
    const platform = isPlatform(u);
    return this.#system(async (tx) => {
      await this.#checkConfig(tx, tenantId, body.config);
      if (await repo.keyExists(tx, tenantId, body.key)) throw sourceError("SOURCE_KEY_TAKEN");
      const row = await repo.insertSource(tx, {
        tenantId,
        key: body.key,
        kind: body.kind,
        config: body.config,
        description: body.description,
        actorId: u.userId,
      });
      return toView(row, [], platform);
    });
  }

  async list(
    u: AuthUser,
    q: {
      tenant_id?: string;
      kind?: SourceView["kind"];
      limit: number;
      cursor?: string;
    },
  ): Promise<SourceListResponse> {
    const tenantId = readTenant(u, q.tenant_id);
    const platform = isPlatform(u);
    const afterKey = decodeCursor(q.cursor);
    return this.#system(async (tx) => {
      const rows = await repo.listSources(tx, { tenantId, kind: q.kind, afterKey, limit: q.limit });
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      const items: SourceView[] = [];
      for (const r of page)
        items.push(toView(r, await repo.usedByKeys(tx, tenantId, r.key), platform));
      return {
        items,
        next_cursor: rows.length > q.limit && last ? encodeCursor(last.key) : null,
      };
    });
  }

  async get(u: AuthUser, key: string, tenantQ: string | undefined): Promise<SourceView> {
    const tenantId = readTenant(u, tenantQ);
    const platform = isPlatform(u);
    return this.#system(async (tx) => {
      const row = await repo.readSource(tx, tenantId, key);
      if (!row) throw sourceError("SOURCE_NOT_FOUND");
      return toView(row, await repo.usedByKeys(tx, tenantId, key), platform);
    });
  }

  async update(
    u: AuthUser,
    key: string,
    tenantQ: string | undefined,
    body: SourceUpdateRequest,
  ): Promise<SourceView> {
    const tenantId = readTenant(u, tenantQ);
    const platform = isPlatform(u);
    return this.#system(async (tx) => {
      const row = await repo.readSource(tx, tenantId, key, true);
      if (!row) throw sourceError("SOURCE_NOT_FOUND");
      // Nguồn local_path hiện tại HOẶC đổi sang local_path ⇒ chỉ platform_admin (PB-R21).
      if ((row.kind === "local_path" || body.config.kind === "local_path") && !platform)
        throw sourceError("SOURCE_FORBIDDEN_KIND");
      assertVersion(row.version, body.version);
      // PB-R08 · đổi LOẠI khi đang dùng ⇒ chặn (đổi url/branch cùng loại được).
      if (body.config.kind !== row.kind) {
        const refs = await repo.inUseRefs(tx, tenantId, key);
        if (refs.length) throw sourceError("SOURCE_IN_USE", { refs });
      }
      await this.#checkConfig(tx, tenantId, body.config);
      const updated = await repo.updateSource(tx, row.id, {
        config: body.config,
        description: body.description,
        actorId: u.userId,
      });
      return toView(updated, await repo.usedByKeys(tx, tenantId, key), platform);
    });
  }

  async remove(
    u: AuthUser,
    key: string,
    tenantQ: string | undefined,
    version: number,
  ): Promise<void> {
    const tenantId = readTenant(u, tenantQ);
    const platform = isPlatform(u);
    await this.#system(async (tx) => {
      const row = await repo.readSource(tx, tenantId, key, true);
      if (!row) throw sourceError("SOURCE_NOT_FOUND");
      if (row.kind === "local_path" && !platform) throw sourceError("SOURCE_FORBIDDEN_KIND");
      assertVersion(row.version, version);
      const refs = await repo.inUseRefs(tx, tenantId, key);
      if (refs.length) throw sourceError("SOURCE_IN_USE", { refs });
      await repo.softDeleteSource(tx, row.id, u.userId);
    });
  }

  /** ADM-FR-68/C3 · picker tài liệu library của tenant (`GET /admin/sources/library-documents`). */
  async libraryDocs(
    u: AuthUser,
    q: { tenant_id?: string; q?: string; limit: number; cursor?: string },
  ): Promise<LibraryDocListResponse> {
    const tenantId = readTenant(u, q.tenant_id);
    const after = decodeDocCursor(q.cursor);
    return this.#system(async (tx) => {
      const rows = await repo.listLibraryDocs(tx, {
        tenantId,
        q: q.q,
        afterName: after?.[0],
        afterId: after?.[1],
        limit: q.limit,
      });
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      return {
        items: page.map((r) => ({
          id: r.id,
          name: r.name,
          version: r.id,
          updated_at: r.created_at,
        })),
        next_cursor: rows.length > q.limit && last ? encodeDocCursor([last.name, last.id]) : null,
      };
    });
  }

  /** Chip nguồn cho user thường (`GET /process-runs/sources`) — scope user, RLS lọc tenant. */
  async chips(u: AuthUser): Promise<ProcessSourceChip[]> {
    const rows = await withHubScope(
      this.db,
      { kind: "user", tenantId: u.tenantId, userId: u.userId },
      (tx) => repo.chipRows(tx),
    );
    return rows.map((r) => ({
      key: r.key,
      kind: r.kind,
      description: r.description,
      ...(r.config.kind === "git_remote" ? { default_branch: r.config.branch } : {}),
    }));
  }
}
