// HUB-FR-68 · HUB-FR-69 · HUB-BR-15 · HUB-BR-30 · spec H4b-1 §3 · plan §3, D4, D8, D9, D11, D14 · nghiệp vụ secrets:
// tạo (id sinh trước khi mã hoá — AAD cần id), đọc metadata, thay giá trị (version), xoá cứng (used_by chặn, FK chốt cuối).
// Mọi ghi qua `withConfigWrite` (khoá config_meta → ghi → bump → audit → NOTIFY); Studio scope `system`, route tenant scope
// `user` của tenant đích. Giá trị chỉ đi vào `sealHubSecret` — không bao giờ vào SQL, log, audit, response hay lỗi.
import type {
  HubSecret,
  HubSecretKind,
  HubSecretListResponse,
  SecretUsedBy,
} from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { type HubScope, withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../lib/auth.middleware";
import type { Db } from "../../lib/db";
import { appError } from "../../lib/errors";
import { validationError } from "../../lib/http";
import type { HubAuditWriter } from "../../lib/hub-audit";
import { type StudioAudit, withConfigWrite } from "../studio/studio-write";
import { type SecretKey, sealHubSecret } from "./secrets.crypto";
import { secretError, secretsNotConfigured } from "./secrets.errors";
import * as repo from "./secrets.repo";
import {
  canManageSecret,
  decodeSecretCursor,
  encodeSecretCursor,
  type SecretRoute,
  secretAuditSnapshot,
  secretEntityName,
  secretScopeOk,
} from "./secrets.rules";

export type SecretsServiceDeps = { db: Db; audit: HubAuditWriter; key: SecretKey | null };

/** Route gọi: Studio = `{route: studio, filter: {}, scope: system}`; tenant = filter `source_credential` + tenant, scope user. */
export type SecretTarget = { route: SecretRoute; filter: repo.SecretFilter; scope: HubScope };

export const studioTarget: SecretTarget = {
  route: "studio",
  filter: {},
  scope: { kind: "system" },
};

/** Route tenant (D13): tenant đích đã chốt bằng `credentialTenant`. */
export const tenantTarget = (u: AuthUser, tenantId: string): SecretTarget => ({
  route: "tenant",
  filter: { kind: "source_credential", tenantId },
  scope: { kind: "user", tenantId, userId: u.userId },
});

export type CreateInput = {
  kind: HubSecretKind;
  name: string;
  value: string;
  tenantId: string | null;
};
export type ListInput = {
  kind?: HubSecretKind;
  tenantId?: string;
  q?: string;
  limit: number;
  cursor?: string;
};

const tenantIssue = (message: string) =>
  validationError([{ path: ["tenant_id"], code: "custom", message }]);

export function toHubSecret(r: repo.SecretViewRow, usedBy: SecretUsedBy[]): HubSecret {
  return {
    id: r.id,
    kind: r.kind,
    tenant: r.tenantId
      ? { id: r.tenantId, key: r.tenantKey ?? "", name: r.tenantName ?? "" }
      : null,
    name: r.name,
    version: r.version,
    used_by: usedBy,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
    updated_by: r.updatedBy,
  };
}

function auditOf(
  action: "create" | "rotate" | "delete",
  r: { id: string; kind: HubSecretKind; tenantId: string | null; name: string },
  before: number | null,
  after: number | null,
): StudioAudit {
  const snap = (version: number | null) =>
    version === null ? null : secretAuditSnapshot({ ...r, version });
  return {
    tenantId: r.tenantId,
    action,
    entity: "secret",
    entityId: r.id,
    entityName: secretEntityName(r.kind, r.name),
    before: snap(before),
    after: snap(after),
    summary: { kind: r.kind },
  };
}

function pgCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const c = typeof e?.code === "string" ? e.code : e?.cause?.code;
  return typeof c === "string" ? c : undefined;
}

export class SecretsService {
  constructor(private readonly d: SecretsServiceDeps) {}

  async #view(tx: Tx, id: string): Promise<HubSecret> {
    const row = await repo.readSecret(tx, id, {});
    if (!row) throw appError("NOT_FOUND");
    return toHubSecret(row, (await repo.usedByMany(tx, [id])).get(id) ?? []);
  }

  /** Khoá hàng (vắng/không thuộc filter ⇒ 404 cùng thân) → version lệch ⇒ VERSION_CONFLICT{current, updated_at}. */
  async #lock(tx: Tx, t: SecretTarget, id: string, version: number): Promise<repo.SecretViewRow> {
    const row = await repo.readSecret(tx, id, t.filter, true);
    if (!row) throw appError("NOT_FOUND");
    if (row.version !== version) {
      const current = toHubSecret(row, (await repo.usedByMany(tx, [id])).get(id) ?? []);
      throw appError("VERSION_CONFLICT", { current, updated_at: current.updated_at });
    }
    return row;
  }

  #key(): SecretKey {
    if (!this.d.key) throw secretsNotConfigured();
    return this.d.key;
  }

  async create(u: AuthUser, t: SecretTarget, b: CreateInput): Promise<HubSecret> {
    if (!canManageSecret(u.role, b.kind, t.route)) throw appError("FORBIDDEN");
    if (!secretScopeOk(b.kind, b.tenantId)) throw tenantIssue("tenant_id not allowed for kind");
    const tenantId = b.tenantId === null ? null : b.tenantId.toLowerCase(); // RV1 #1: = dạng Postgres trả
    const w = { db: this.d.db, audit: this.d.audit };
    const { result } = await withConfigWrite(
      w,
      u,
      async (tx) => {
        if (tenantId !== null && !(await repo.tenantExists(tx, tenantId)))
          throw tenantIssue("tenant not found");
        if (await repo.nameTaken(tx, b.kind, tenantId, b.name))
          throw secretError("SECRET_NAME_TAKEN");
        const key = this.#key();
        const id = crypto.randomUUID(); // D4: id trước khi mã hoá (AAD)
        const sealed = sealHubSecret(key, { id, kind: b.kind, tenantId }, b.value);
        await repo
          .insertSecret(tx, {
            id,
            kind: b.kind,
            tenantId,
            name: b.name,
            sealed,
            actorId: u.userId,
          })
          .catch((err) => {
            throw pgCode(err) === "23505" ? secretError("SECRET_NAME_TAKEN") : err;
          });
        const meta = { id, kind: b.kind, tenantId, name: b.name };
        return { result: await this.#view(tx, id), audit: auditOf("create", meta, null, 1) };
      },
      t.scope,
    );
    return result;
  }

  async rotate(
    u: AuthUser,
    t: SecretTarget,
    id: string,
    b: { version: number; value: string },
  ): Promise<HubSecret> {
    const w = { db: this.d.db, audit: this.d.audit };
    const { result } = await withConfigWrite(
      w,
      u,
      async (tx) => {
        const row = await this.#lock(tx, t, id, b.version);
        const key = this.#key();
        const sealed = sealHubSecret(
          key,
          { id: row.id, kind: row.kind, tenantId: row.tenantId },
          b.value,
        );
        await repo.updateSecretValue(tx, id, sealed, u.userId);
        const audit = auditOf("rotate", row, row.version, row.version + 1);
        return { result: await this.#view(tx, id), audit };
      },
      t.scope,
    );
    return result;
  }

  async remove(u: AuthUser, t: SecretTarget, id: string, version: number): Promise<void> {
    const w = { db: this.d.db, audit: this.d.audit };
    await withConfigWrite(
      w,
      u,
      async (tx) => {
        const row = await this.#lock(tx, t, id, version);
        await this.#assertUnused(tx, id);
        // D9 · FK RESTRICT là chốt cuối: 23503 trong savepoint ⇒ tính lại used_by, 409.
        await tx
          .transaction((sp) => repo.deleteSecret(sp, id))
          .catch(async (err) => {
            if (pgCode(err) !== "23503") throw err;
            await this.#assertUnused(tx, id);
            throw err; // tham chiếu chưa có nhánh used_by ⇒ 500 (không trả used_by rỗng trái contract)
          });
        return { result: undefined, audit: auditOf("delete", row, row.version, null) };
      },
      t.scope,
    );
  }

  async #assertUnused(tx: Tx, id: string): Promise<void> {
    const usedBy = (await repo.usedByMany(tx, [id])).get(id) ?? [];
    if (usedBy.length > 0) throw secretError("SECRET_IN_USE", { used_by: usedBy });
  }

  get(t: SecretTarget, id: string): Promise<HubSecret> {
    return withHubScope(this.d.db, t.scope, async (tx) => {
      const row = await repo.readSecret(tx, id, t.filter);
      if (!row) throw appError("NOT_FOUND");
      return toHubSecret(row, (await repo.usedByMany(tx, [id])).get(id) ?? []);
    });
  }

  list(t: SecretTarget, q: ListInput): Promise<HubSecretListResponse> {
    const filter = { ...t.filter };
    if (q.kind !== undefined && filter.kind === undefined) filter.kind = q.kind;
    if (q.tenantId !== undefined && filter.tenantId === undefined) filter.tenantId = q.tenantId;
    const after = decodeSecretCursor(q.cursor);
    return withHubScope(this.d.db, t.scope, async (tx) => {
      const rows = await repo.listSecrets(tx, { ...filter, q: q.q, after, limit: q.limit });
      const page = rows.slice(0, q.limit);
      const used = await repo.usedByMany(
        tx,
        page.map((r) => r.id),
      );
      const last = page.at(-1);
      return {
        items: page.map((r) => toHubSecret(r, used.get(r.id) ?? [])),
        next_cursor: rows.length > q.limit && last ? encodeSecretCursor(repo.cursorOf(last)) : null,
      };
    });
  }
}
