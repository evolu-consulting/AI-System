// HUB-FR-66 · HUB-FR-69 · spec H4b2 §3 A · plan §3.1, D5, D6, D11 · nghiệp vụ provider Studio. Mọi ghi qua
// `withConfigWrite` (scope system: khoá `config_meta` → khoá hàng → version → ghi → bump → audit → NOTIFY). Đọc: một
// transaction REPEATABLE READ read only. Audit before/after = trường sửa được (`secret_id` là id, không giá trị).
import type { ProviderCreate, ProviderDetail, ProviderUpdate } from "@ai/contracts/studio";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../../lib/auth.middleware";
import { appError } from "../../../lib/errors";
import { validationError } from "../../../lib/http";
import { type StudioAudit, type StudioWriteDeps, withConfigWrite } from "../studio-write";
import { modelError } from "./models.errors";
import {
  type Env,
  isReadonlyProvider,
  type ProviderEditable,
  providerChanged,
  providerDeleteBlock,
  providerShapeProblem,
  secretRefProblem,
} from "./models.rules";
import { editableOf, toProviderDetail } from "./providers.map";
import {
  deleteProvider,
  insertProvider,
  type ProviderDbRow,
  profilesUsing,
  providerHasJobs,
  providerIdByKey,
  readProvider,
  readProviderDetail,
  readSecretRef,
  updateProvider,
} from "./providers.repo";

export type ProvidersDeps = StudioWriteDeps & { env: Env };

const pgCode = (err: unknown): unknown => {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  return e?.code ?? e?.cause?.code;
};

/** Hình dạng theo kind (400 path `secret_id`/`base_url`). */
function assertShape(
  p: { kind: "api" | "subscription"; base_url: string | null; secret_id: string | null },
  env: Env,
): void {
  const bad = providerShapeProblem(p, env);
  if (bad)
    throw validationError([
      { path: [bad.path], code: "custom", message: `${bad.path} ${bad.reason}` },
    ]);
}

/** `secret_id` phải là secret `provider_api_key` cấp nền tảng (400 `INVALID_REFERENCE`). */
async function assertSecret(tx: Tx, secretId: string | null): Promise<void> {
  if (secretId === null) return;
  const reason = secretRefProblem(await readSecretRef(tx, secretId));
  if (reason) throw appError("INVALID_REFERENCE", { field: "secret_id", reason });
}

function audit(
  row: Pick<ProviderDbRow, "id" | "key">,
  action: "create" | "update" | "enable" | "disable" | "delete",
  before: ProviderEditable | null,
  after: ProviderEditable | null,
): StudioAudit {
  const fields = before && after ? providerChanged(before, after) : [];
  return {
    tenantId: null,
    action,
    entity: "provider",
    entityId: row.id,
    entityName: row.key,
    before,
    after,
    summary: { fields },
  };
}

/** Chi tiết theo id trong `tx` (vắng ⇒ 404). Dùng chung đọc, trả sau ghi, `VERSION_CONFLICT.current`. */
export async function providerDetail(tx: Tx, id: string): Promise<ProviderDetail> {
  const row = await readProviderDetail(tx, id);
  if (!row) throw appError("NOT_FOUND");
  return toProviderDetail(row, await profilesUsing(tx, row.key));
}

export class ProvidersService {
  constructor(private readonly d: ProvidersDeps) {}

  /** GET :id · 404 khi không có. */
  get(id: string): Promise<ProviderDetail> {
    return withHubScope(this.d.db, { kind: "system" }, (tx) => providerDetail(tx, id), {
      isolationLevel: "repeatable read",
      accessMode: "read only",
    });
  }

  /** POST · 201 · hình dạng (400) → KEY_TAKEN → secret ref → INSERT (`dev_only` = vendor fake) → audit `create`. */
  async create(actor: AuthUser, b: ProviderCreate): Promise<ProviderDetail> {
    assertShape(b, this.d.env);
    const { result } = await withConfigWrite(this.d, actor, async (tx) => {
      if (await providerIdByKey(tx, b.key)) throw appError("KEY_TAKEN", { field: "key" });
      await assertSecret(tx, b.secret_id);
      const id = await insertProvider(tx, {
        key: b.key,
        kind: b.kind,
        vendor: b.vendor,
        baseUrl: b.base_url,
        secretId: b.secret_id,
        maxConcurrency: b.max_concurrency,
        enabled: b.enabled,
        devOnly: b.vendor === "fake",
      }).catch((err: unknown) => {
        throw pgCode(err) === "23505" ? appError("KEY_TAKEN", { field: "key" }) : err;
      });
      const { key: _k, kind: _t, vendor: _v, ...after } = b;
      const a = audit({ id, key: b.key }, "create", null, after);
      return { result: await providerDetail(tx, id), audit: a };
    });
    return result;
  }

  /** Khoá hàng (vắng ⇒ 404) → readonly ⇒ 409 → version lệch ⇒ `VERSION_CONFLICT{current, updated_at}`. */
  async #lock(tx: Tx, id: string, version: number): Promise<ProviderDbRow> {
    const row = await readProvider(tx, id, true);
    if (!row) throw appError("NOT_FOUND");
    if (isReadonlyProvider(row.vendor)) throw modelError("PROVIDER_READONLY");
    if (row.version !== version)
      throw appError("VERSION_CONFLICT", {
        current: await providerDetail(tx, id),
        updated_at: new Date(row.updatedAt).toISOString(),
      });
    return row;
  }

  /** Ghi trường sửa được; không đổi ⇒ trả hiện tại, audit null (không bump). */
  async #write(
    actor: AuthUser,
    { id, version }: { id: string; version: number },
    next: (tx: Tx, row: ProviderDbRow) => Promise<ProviderEditable>,
    action: (after: ProviderEditable) => "update" | "enable" | "disable",
  ): Promise<ProviderDetail> {
    const { result } = await withConfigWrite(this.d, actor, async (tx) => {
      const row = await this.#lock(tx, id, version);
      const before = editableOf(row);
      const after = await next(tx, row);
      if (providerChanged(before, after).length === 0)
        return { result: await providerDetail(tx, id), audit: null };
      await updateProvider(tx, id, {
        baseUrl: after.base_url,
        secretId: after.secret_id,
        maxConcurrency: after.max_concurrency,
        enabled: after.enabled,
      });
      const a = audit(row, action(after), before, after);
      return { result: await providerDetail(tx, id), audit: a };
    });
    return result;
  }

  /** PUT · 200 · hình dạng theo `kind` DB → secret ref → UPDATE `version + 1` → audit `update`. */
  update(actor: AuthUser, id: string, b: ProviderUpdate): Promise<ProviderDetail> {
    const { version, ...next } = b;
    const apply = async (tx: Tx, row: ProviderDbRow): Promise<ProviderEditable> => {
      assertShape({ ...next, kind: row.kind }, this.d.env);
      await assertSecret(tx, next.secret_id);
      return next;
    };
    return this.#write(actor, { id, version }, apply, () => "update");
  }

  /** PATCH enabled · 200 · chỉ đổi `enabled` → audit `enable`/`disable`. */
  setEnabled(
    actor: AuthUser,
    id: string,
    b: { version: number; enabled: boolean },
  ): Promise<ProviderDetail> {
    const apply = async (_tx: Tx, row: ProviderDbRow) => ({
      ...editableOf(row),
      enabled: b.enabled,
    });
    return this.#write(actor, { id, version: b.version }, apply, (a) =>
      a.enabled ? "enable" : "disable",
    );
  }

  /** DELETE · 204 · khoá + version → IN_USE / HAS_HISTORY → DELETE (cascade state/models) → audit `delete`. */
  async remove(actor: AuthUser, id: string, version: number): Promise<void> {
    await withConfigWrite(this.d, actor, async (tx) => {
      const row = await this.#lock(tx, id, version);
      const profiles = await profilesUsing(tx, row.key);
      const hasJobs = await providerHasJobs(tx, row.key);
      const block = providerDeleteBlock({ vendor: row.vendor, profiles, hasJobs });
      if (block === "PROVIDER_IN_USE") throw modelError(block, { profiles });
      if (block) throw modelError(block);
      await deleteProvider(tx, id).catch((err: unknown) => {
        throw pgCode(err) === "23503" ? modelError("PROVIDER_HAS_HISTORY") : err;
      });
      return { result: null, audit: audit(row, "delete", editableOf(row), null) };
    });
  }
}
