// HUB-FR-131 · HUB-BR-36 · HUB-BR-37 · CR-073 · spec K1 §3.2, §3.5 · plan §3.3, §4 · Studio CRUD kết nối KnowledgeHub (nền
// tảng, scope system). Mọi ghi qua `withConfigWrite` (khoá config_meta → ghi → bump → audit → NOTIFY). Thứ tự kiểm:
// (PUT/DELETE: khoá hàng 404 → version 409) → URL 422 → secret 422 → trùng 409 → ghi. Không bao giờ chạm giá trị khoá.
import type {
  KhConnection,
  KhConnectionListResponse,
  KhConnectionUpdate,
  KhConnectionWrite,
} from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { KhConfig } from "../../config/env";
import type { AuthUser } from "../../lib/auth.middleware";
import type { Db } from "../../lib/db";
import { appError } from "../../lib/errors";
import type { HubAuditWriter } from "../../lib/hub-audit";
import { type StudioAudit, withConfigWrite } from "../studio/studio-write";
import { khError } from "./kh.errors";
import * as repo from "./kh.repo";
import {
  decodeKhCursor,
  encodeKhCursor,
  khConnectionAudit,
  khResetsCheck,
  khSecretReject,
  khUrlPolicy,
  khUsableOrigins,
} from "./kh.rules";

export type KhStudioDeps = { db: Db; audit: HubAuditWriter; cfg: KhConfig; dev: boolean };

export function toKhConnection(r: repo.KhConnRow): KhConnection {
  return {
    id: r.id,
    name: r.name,
    base_url: r.baseUrl,
    secret: { id: r.secretId, name: r.secretName },
    summary_project: r.summaryProject,
    status: r.checkStatus,
    check: r.checkStatus === "unchecked" ? null : r.checkResult,
    agents_count: r.agentsCount,
    version: r.version,
    updated_at: r.updatedAt,
    updated_by: r.updatedBy,
  };
}

type Snap = { name: string; baseUrl: string; secretId: string; summaryProject: string | null };

function auditOf(
  action: "create" | "update" | "delete",
  id: string,
  before: (Snap & { version: number }) | null,
  after: (Snap & { version: number }) | null,
): StudioAudit {
  return {
    tenantId: null,
    action,
    entity: "kh_connection",
    entityId: id,
    entityName: (after ?? before)?.name ?? "",
    before: before && khConnectionAudit(before),
    after: after && khConnectionAudit(after),
    summary: {},
  };
}

const pgCode = (err: unknown): string | undefined => {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const c = typeof e?.code === "string" ? e.code : e?.cause?.code;
  return typeof c === "string" ? c : undefined;
};

export class KhStudioService {
  constructor(private readonly d: KhStudioDeps) {}

  #w() {
    return { db: this.d.db, audit: this.d.audit };
  }

  /** URL (chuẩn hoá) → secret → trùng tên/URL (trừ chính nó). Trả bản ghi đã chuẩn hoá. */
  async #validate(tx: Tx, b: KhConnectionWrite, exceptId: string | null): Promise<Snap> {
    const url = khUrlPolicy(b.base_url, this.d.cfg.allowedOrigins, { dev: this.d.dev });
    if (!url.ok) throw khError("KH_URL_NOT_ALLOWED", { reason: url.reason });
    const reason = khSecretReject(await repo.readSecretRef(tx, b.secret_id));
    if (reason) throw khError("KH_SECRET_INVALID", { reason });
    const snap = {
      name: b.name,
      baseUrl: url.baseUrl,
      secretId: b.secret_id.toLowerCase(),
      summaryProject: b.summary_project ?? null,
    };
    await this.#assertNoClash(tx, snap, exceptId);
    return snap;
  }

  async #assertNoClash(tx: Tx, s: Snap, exceptId: string | null): Promise<void> {
    const clash = await repo.findClash(tx, { name: s.name, baseUrl: s.baseUrl, exceptId });
    if (clash) throw khError("KH_CONNECTION_EXISTS", clash);
  }

  /** Ghi trong savepoint: 23505 (đua ngoài khoá config) ⇒ tính lại trùng ⇒ 409. */
  async #write(tx: Tx, s: Snap, exceptId: string | null, fn: (sp: Tx) => Promise<void>) {
    await tx.transaction(fn).catch(async (err) => {
      if (pgCode(err) !== "23505") throw err;
      await this.#assertNoClash(tx, s, exceptId);
      throw err;
    });
  }

  async #lock(tx: Tx, id: string, version: number): Promise<repo.KhConnRow> {
    const row = await repo.readConn(tx, id, true);
    if (!row) throw appError("NOT_FOUND");
    if (row.version !== version)
      throw appError("VERSION_CONFLICT", {
        current: toKhConnection(row),
        updated_at: row.updatedAt,
      });
    return row;
  }

  async #view(tx: Tx, id: string): Promise<KhConnection> {
    const row = await repo.readConn(tx, id);
    if (!row) throw appError("NOT_FOUND");
    return toKhConnection(row);
  }

  list(q: { limit: number; cursor?: string }): Promise<KhConnectionListResponse> {
    const after = decodeKhCursor(q.cursor);
    return withHubScope(this.d.db, { kind: "system" }, async (tx) => {
      const rows = await repo.listConns(tx, { after, limit: q.limit });
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      return {
        items: page.map(toKhConnection),
        next_cursor: rows.length > q.limit && last ? encodeKhCursor(repo.cursorOf(last)) : null,
        allowed_origins: khUsableOrigins(this.d.cfg.allowedOrigins, { dev: this.d.dev }),
        timeout_ms: this.d.cfg.timeoutMs,
      };
    });
  }

  async create(u: AuthUser, b: KhConnectionWrite): Promise<KhConnection> {
    const { result } = await withConfigWrite(this.#w(), u, async (tx) => {
      const s = await this.#validate(tx, b, null);
      const id = crypto.randomUUID();
      await this.#write(tx, s, null, (sp) => repo.insertConn(sp, id, { ...s, actorId: u.userId }));
      const audit = auditOf("create", id, null, { ...s, version: 1 });
      return { result: await this.#view(tx, id), audit };
    });
    return result;
  }

  async update(u: AuthUser, id: string, b: KhConnectionUpdate): Promise<KhConnection> {
    const { result } = await withConfigWrite(this.#w(), u, async (tx) => {
      const row = await this.#lock(tx, id, b.version);
      const s = await this.#validate(tx, b, id);
      const resetCheck = khResetsCheck(row, s);
      await this.#write(tx, s, id, (sp) =>
        repo.updateConn(sp, id, { ...s, actorId: u.userId, resetCheck }),
      );
      const audit = auditOf("update", id, row, { ...s, version: row.version + 1 });
      return { result: await this.#view(tx, id), audit };
    });
    return result;
  }

  /** Agent đang tick ⇒ 409 `KH_CONNECTION_IN_USE {agents}`; FK RESTRICT `agent_kh_conn_fk` là chốt cuối. */
  async remove(u: AuthUser, id: string, version: number): Promise<void> {
    await withConfigWrite(this.#w(), u, async (tx) => {
      const row = await this.#lock(tx, id, version);
      const agents = await repo.countAgents(tx, id);
      if (agents > 0) throw khError("KH_CONNECTION_IN_USE", { agents });
      await tx
        .transaction((sp) => repo.deleteConn(sp, id))
        .catch(async (err) => {
          if (pgCode(err) !== "23503") throw err;
          throw khError("KH_CONNECTION_IN_USE", {
            agents: Math.max(1, await repo.countAgents(tx, id)),
          });
        });
      return { result: undefined, audit: auditOf("delete", id, row, null) };
    });
  }
}
