// ADM-FR-50, ADM-BR-04 · nghiệp vụ secrets (plan M2 §5 "Secrets"). Không biết HTTP; giá trị chỉ sống trong bộ nhớ tới
// khi mã hoá xong, không bao giờ trả về/log/gửi xuống DB dạng rõ. Callback withScope chỉ làm việc DB + tính toán cục bộ
// (TECH-DEBT #13). create: mã hoá trước withScope (retry dùng lại bản mã); PUT: mã hoá trong callback (retry sinh IV mới).
import type {
  Secret,
  SecretCreateRequest,
  SecretListQuery,
  SecretListResponse,
  SecretNoteRequest,
} from "@ai/contracts";
import { type Db, type DbScope, type Tx, withScope } from "@ai/db";
import type { Actor } from "../../lib/auth-middleware";
import { appError } from "../../lib/errors";
import { foreignKeyViolation } from "../../lib/pg-errors";
import { encryptSecret, type SecretKey } from "../../lib/secret-crypto";
import { mapSecretConflict } from "./secrets.errors";
import * as repo from "./secrets.repo";
import { checkSecretDelete, secretLast4 } from "./secrets.rules";

export type SecretsCtx = { db: Db; secretKey?: SecretKey };
export type Call = { ctx: SecretsCtx; actor: Actor; scope: DbScope };

export function toSecret(r: repo.SecretRow): Secret {
  return {
    id: r.id,
    name: r.name,
    last4: r.last4,
    note: r.note,
    used_by: r.usedBy,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
    updated_by: r.updatedBy,
  };
}

/** Thiếu khoá (fixture cũ) → lỗi thường → 500 INTERNAL_ERROR; message không chứa dữ liệu người dùng. */
function requireKey(c: Call): SecretKey {
  if (!c.ctx.secretKey) throw new Error("secret key not configured");
  return c.ctx.secretKey;
}

function seal(key: SecretKey, id: string, value: string): repo.Sealed {
  const s = encryptSecret(key, id, value);
  return {
    ciphertext: Buffer.from(s.ciphertext),
    iv: Buffer.from(s.iv),
    keyVersion: s.keyVersion,
    last4: secretLast4(value),
  };
}

async function reread(tx: Tx, name: string): Promise<Secret> {
  const row = await repo.findSecretRow(tx, name);
  if (!row) throw appError("NOT_FOUND");
  return toSecret(row);
}

async function mustLock(tx: Tx, name: string): Promise<string> {
  const id = await repo.lockSecretByName(tx, name);
  if (!id) throw appError("NOT_FOUND");
  return id;
}

export async function listSecrets(c: Call, q: SecretListQuery): Promise<SecretListResponse> {
  const { rows, counts } = await withScope(c.ctx.db, c.scope, (tx) => repo.listSecrets(tx, q));
  return {
    items: rows.map(({ total: _t, ...r }) => toSecret(r)),
    total: rows[0]?.total ?? 0,
    counts,
  };
}

export async function createSecret(c: Call, input: SecretCreateRequest): Promise<Secret> {
  const key = requireKey(c);
  const id = Bun.randomUUIDv7();
  const sealed = seal(key, id, input.value);
  return withScope(c.ctx.db, c.scope, async (tx) => {
    const row = { ...sealed, id, name: input.name, note: input.note ?? null };
    await tx
      .transaction((sp) => repo.insertSecret(sp, { ...row, actorId: c.actor.userId }))
      .catch(mapSecretConflict);
    return reread(tx, input.name);
  });
}

/** Thay giá trị (M2-R04): IV mới, last4 mới, giữ id/note/used_by. */
export function replaceSecret(c: Call, name: string, value: string): Promise<Secret> {
  const key = requireKey(c);
  return withScope(c.ctx.db, c.scope, async (tx) => {
    const id = await mustLock(tx, name);
    await repo.updateSecret(tx, id, { ...seal(key, id, value), actorId: c.actor.userId });
    return reread(tx, name);
  });
}

/** Sửa ghi chú: không đụng bản mã (Y6). */
export function updateSecretNote(c: Call, name: string, input: SecretNoteRequest): Promise<Secret> {
  return withScope(c.ctx.db, c.scope, async (tx) => {
    const id = await mustLock(tx, name);
    await repo.updateSecret(tx, id, { note: input.note, actorId: c.actor.userId });
    return reread(tx, name);
  });
}

function failInUse(usedBy: string[]): void {
  const e = checkSecretDelete(usedBy);
  if (e) throw appError(e.code, e.details);
}

/** 404 → SECRET_IN_USE → xoá thật. 23503 (workflow chèn đua) → đọc lại used_by → SECRET_IN_USE. */
export function deleteSecret(c: Call, name: string): Promise<void> {
  return withScope(c.ctx.db, c.scope, async (tx) => {
    const id = await mustLock(tx, name);
    failInUse(await repo.usedByOf(tx, id));
    await tx
      .transaction((sp) => repo.deleteSecret(sp, id))
      .catch(async (err) => {
        if (!foreignKeyViolation(err)) throw err;
        failInUse(await repo.usedByOf(tx, id));
        throw err;
      });
  });
}

/** Cho module workflows: giữ secret `FOR SHARE` tới khi commit; thiếu → INVALID_REFERENCE {field:"secret_id"}. */
export async function lockSecretRef(tx: Tx, id: string): Promise<{ id: string; name: string }> {
  const s = await repo.shareSecretById(tx, id);
  if (!s) throw appError("INVALID_REFERENCE", { field: "secret_id", ids: [id] });
  return s;
}
