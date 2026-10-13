// HUB-FR-67 · HUB-FR-69 · spec H4b2 §3 B · plan §3.3, D5, D6, D10 · nghiệp vụ model profile Studio. Mọi ghi qua
// `withConfigWrite` (scope system: khoá `config_meta` → khoá hàng → version → ghi → bump → audit → NOTIFY). Đọc: một
// transaction REPEATABLE READ read only. Audit before/after = `{ steps }`; steps giống hệt ⇒ không bump, không audit.
import type { ModelProfile, ModelProfileUpdate, ModelProfileWrite } from "@ai/contracts/studio";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../../lib/auth.middleware";
import { appError } from "../../../lib/errors";
import { validationError } from "../../../lib/http";
import type { StudioAudit, StudioWriteDeps } from "../studio-write";
import { withConfigWrite } from "../studio-write";
import { modelError } from "./models.errors";
import { stepsProblem } from "./models.rules";
import {
  indexProviders,
  type ModelProfileItem,
  normSteps,
  sameSteps,
  toModelProfile,
  toModelProfileItem,
} from "./profiles.map";
import {
  agentsUsing,
  deleteProfile,
  insertProfile,
  type ModelProfileStep,
  type ProfileDbRow,
  profileIdByKey,
  readAgentCounts,
  readProfile,
  readProfiles,
  readProviderViews,
  updateProfile,
} from "./profiles.repo";

export type ProfilesDeps = StudioWriteDeps & { now?: () => Date };

const pgCode = (err: unknown): unknown => {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  return e?.code ?? e?.cause?.code;
};

/** `stepsProblem` trên provider hiện có: vắng/readonly ⇒ 400 INVALID_REFERENCE; trùng ⇒ 400 path `steps.<i>`. */
async function assertSteps(tx: Tx, steps: readonly ModelProfileStep[]): Promise<void> {
  const bad = stepsProblem(steps, indexProviders(await readProviderViews(tx)));
  if (!bad) return;
  if (bad.reason === "duplicate")
    throw validationError([
      { path: ["steps", bad.index], code: "custom", message: "Duplicate step or trigger" },
    ]);
  throw appError("INVALID_REFERENCE", { field: "steps", index: bad.index, reason: bad.reason });
}

function audit(
  row: Pick<ProfileDbRow, "id" | "key">,
  action: "create" | "update" | "delete",
  before: readonly ModelProfileStep[] | null,
  after: readonly ModelProfileStep[] | null,
): StudioAudit {
  return {
    tenantId: null,
    action,
    entity: "model_profile",
    entityId: row.id,
    entityName: row.key,
    before: before && { steps: normSteps(before) },
    after: after && { steps: normSteps(after) },
    summary: { steps: (after ?? before ?? []).length },
  };
}

/** Chi tiết theo id trong `tx` (vắng ⇒ 404). Dùng chung đọc, trả sau ghi, `VERSION_CONFLICT.current`. */
export async function profileDetail(tx: Tx, id: string, now: Date): Promise<ModelProfile> {
  const row = await readProfile(tx, id);
  if (!row) throw appError("NOT_FOUND");
  const providers = indexProviders(await readProviderViews(tx));
  const agentCount = (await readAgentCounts(tx)).get(id) ?? 0;
  return toModelProfile(row, { providers, agentCount, now, usedBy: await agentsUsing(tx, id) });
}

/** List (dùng ở `GET /model-profiles`, H4a D4): 1 câu profiles + 1 câu providers⋈state + 1 câu đếm agents. */
export async function profileItems(tx: Tx, now: Date): Promise<ModelProfileItem[]> {
  const rows = await readProfiles(tx);
  const providers = indexProviders(await readProviderViews(tx));
  const counts = await readAgentCounts(tx);
  return rows.map((r) =>
    toModelProfileItem(r, { providers, agentCount: counts.get(r.id) ?? 0, now }),
  );
}

export class ProfilesService {
  readonly #now: () => Date;
  constructor(private readonly d: ProfilesDeps) {
    this.#now = d.now ?? (() => new Date());
  }

  /** GET :id · 404 khi không có. */
  get(id: string): Promise<ModelProfile> {
    return withHubScope(this.d.db, { kind: "system" }, (tx) => profileDetail(tx, id, this.#now()), {
      isolationLevel: "repeatable read",
      accessMode: "read only",
    });
  }

  /** POST · 201 · KEY_TAKEN → bước (400) → INSERT (version 1) → audit `create`. */
  async create(actor: AuthUser, b: ModelProfileWrite): Promise<ModelProfile> {
    const { result } = await withConfigWrite(this.d, actor, async (tx) => {
      if (await profileIdByKey(tx, b.key)) throw appError("KEY_TAKEN", { field: "key" });
      await assertSteps(tx, b.steps);
      const id = await insertProfile(tx, { key: b.key, steps: normSteps(b.steps) }).catch(
        (err: unknown) => {
          throw pgCode(err) === "23505" ? appError("KEY_TAKEN", { field: "key" }) : err;
        },
      );
      const a = audit({ id, key: b.key }, "create", null, b.steps);
      return { result: await profileDetail(tx, id, this.#now()), audit: a };
    });
    return result;
  }

  /** Khoá hàng (vắng ⇒ 404) → version lệch ⇒ `VERSION_CONFLICT{current, updated_at}`. */
  async #lock(tx: Tx, id: string, version: number): Promise<ProfileDbRow> {
    const row = await readProfile(tx, id, true);
    if (!row) throw appError("NOT_FOUND");
    if (row.version !== version)
      throw appError("VERSION_CONFLICT", {
        current: await profileDetail(tx, id, this.#now()),
        updated_at: new Date(row.updatedAt).toISOString(),
      });
    return row;
  }

  /** PUT · 200 · khoá + version → bước (400) → giống hệt ⇒ trả hiện tại (không bump) → UPDATE `version + 1` → audit. */
  async update(actor: AuthUser, id: string, b: ModelProfileUpdate): Promise<ModelProfile> {
    const { result } = await withConfigWrite(this.d, actor, async (tx) => {
      const row = await this.#lock(tx, id, b.version);
      await assertSteps(tx, b.steps);
      if (sameSteps(row.steps, b.steps))
        return { result: await profileDetail(tx, id, this.#now()), audit: null };
      await updateProfile(tx, id, normSteps(b.steps));
      const a = audit(row, "update", row.steps, b.steps);
      return { result: await profileDetail(tx, id, this.#now()), audit: a };
    });
    return result;
  }

  /** DELETE · 204 · khoá + version → còn agent ⇒ PROFILE_IN_USE{agents} → DELETE → audit `delete`. */
  async remove(actor: AuthUser, id: string, version: number): Promise<void> {
    await withConfigWrite(this.d, actor, async (tx) => {
      const row = await this.#lock(tx, id, version);
      const used = await agentsUsing(tx, id);
      if (used.length > 0) throw modelError("PROFILE_IN_USE", { agents: used });
      // Savepoint: lỗi FK không làm hỏng transaction ngoài ⇒ còn đọc lại được agent đang dùng.
      try {
        await tx.transaction((sp) => deleteProfile(sp, id));
      } catch (err) {
        if (pgCode(err) !== "23503") throw err;
        const now = await agentsUsing(tx, id);
        if (now.length > 0) throw modelError("PROFILE_IN_USE", { agents: now });
        throw appError("VERSION_CONFLICT", {
          current: await profileDetail(tx, id, this.#now()),
          updated_at: new Date(row.updatedAt).toISOString(),
        });
      }
      return { result: null, audit: audit(row, "delete", row.steps, null) };
    });
  }
}
