// ADM-FR-54 · M4-R14 · M4-R15 · M4-AC10 · Import áp dụng (plan-cd §3.3, §8.3–8.4): một tx `configWrite({expectBase})`,
// một audit `import`/`config`, một NOTIFY sau commit; không xoá. Config đổi sau dry-run → 409 `VERSION_CONFLICT {current}`.
// Không nhận giá trị secret qua file: secret mới chỉ từ `secrets` của request (đúng tập `missing_secrets`).
import type { ConfigFile, ImportItem, ImportRequest, ImportResult } from "@ai/contracts";
import { type ConfigSink, ConfigVersionMoved, readConfigVersion, type Tx, withScope } from "@ai/db";
import { auditOf } from "../../lib/audit/audit.write";
import { configWrite } from "../../lib/config/config-write";
import { appError } from "../../lib/errors";
import { validationError } from "../../lib/http";
import { logger } from "../../lib/logger";
import type { Mailer } from "../../lib/mailer";
import { foreignKeyViolation, safeErrorFields, uniqueViolation } from "../../lib/pg-errors";
import type { SecretKey } from "../../lib/secret-crypto";
import { afterLock } from "../../lib/test-hooks";
import { evaluateTenant } from "../quotas/quotas.evaluator";
import { createSecretTx } from "../secrets/secrets.service";
import { mapVersionMoved } from "./transfer.errors";
import { lockForImport, readIds } from "./transfer.ids";
import { checkImportSize, parseConfigText, readFullSnapshot } from "./transfer.import";
import { checkSecretsInput, type ImportPlan, planImport } from "./transfer.rules";
import type { Call, TransferCtx } from "./transfer.service";
import { writeImport } from "./transfer.write";

export type ImportCtx = TransferCtx & { secretKey?: SecretKey; mailer?: Mailer; webUrl?: string };
export type ImportCall = Omit<Call, "ctx"> & { ctx: ImportCtx };

/** Trần mỗi danh sách trong audit (plan-cd §8.3); vượt → `truncated: true`. */
export const AUDIT_LIST_MAX = 500;
const OP = "import.apply" as const;

type Applied = { result: ImportResult; quotaTenants: string[] };

/** Thừa (tên không cần / đã có) → 400 VALIDATION_ERROR; thiếu → 400 SECRETS_REQUIRED (M4-R15). */
function checkSecrets(plan: ImportPlan, given: Record<string, string>): void {
  const r = checkSecretsInput(
    plan.missing_secrets.map((m) => m.name),
    given,
  );
  if (r.extra.length > 0) throw appError("VALIDATION_ERROR", { fields: { secrets: r.extra } });
  if (r.missing.length > 0) throw appError("SECRETS_REQUIRED", { missing: r.missing });
}

function importAudit(
  req: ImportRequest,
  from: number,
  items: readonly ImportItem[],
  secrets: string[],
) {
  const pick = (op: ImportItem["op"]) =>
    items.filter((i) => i.op === op).map((i) => ({ type: i.type, key: i.key }));
  const added = pick("add");
  const updated = pick("update");
  const truncated = [added, updated, secrets].some((l) => l.length > AUDIT_LIST_MAX);
  return auditOf("import", "config", {
    entityId: null,
    entityName: req.file_name,
    tenantId: null,
    before: null,
    after: {
      from_config_version: from,
      added: added.slice(0, AUDIT_LIST_MAX),
      updated: updated.slice(0, AUDIT_LIST_MAX),
      secrets_created: secrets.slice(0, AUDIT_LIST_MAX),
      ...(truncated ? { truncated: true } : {}),
    },
    summary: { file: req.file_name, added_count: added.length, updated_count: updated.length },
  });
}

type Args = { req: ImportRequest; base: number; file: ConfigFile };

/** Secret mới chèn trước workflow (E4); trả tên đã tạo. */
async function createSecrets(
  c: ImportCall,
  a: Args,
  w: { tx: Tx; ch: ConfigSink; ids: Map<string, string> },
  plan: ImportPlan,
) {
  const names = plan.missing_secrets.map((m) => m.name);
  if (names.length === 0) return names;
  const key = c.ctx.secretKey;
  if (!key) throw new Error("secret key not configured");
  for (const name of names) {
    const value = a.req.secrets?.[name] ?? "";
    const input = { name, value, note: "import" };
    const actor = { key, actorId: c.actor.userId, audit: false };
    w.ids.set(name, await createSecretTx(w.tx, w.ch, actor, input));
  }
  return names;
}

async function applyInTx(c: ImportCall, a: Args, tx: Tx, ch: ConfigSink): Promise<Applied> {
  const v = await readConfigVersion(tx);
  if (v !== a.base) throw new ConfigVersionMoved(v);
  const plan = planImport(a.file, await readFullSnapshot(tx, v));
  if (plan.errors.length > 0) throw appError("IMPORT_INVALID", { errors: plan.errors });
  checkSecrets(plan, a.req.secrets ?? {});
  if (plan.items.length === 0)
    return {
      result: { config_version: v, summary: plan.summary, secrets_created: 0 },
      quotaTenants: [],
    };
  const ids = await readIds(tx, plan.items);
  await lockForImport(tx, ids, plan.items);
  const v2 = await readConfigVersion(tx);
  if (v2 !== a.base) throw new ConfigVersionMoved(v2);
  await afterLock(c.ctx.hooks, OP, "locked");
  const created = await createSecrets(c, a, { tx, ch, ids: ids.secrets }, plan);
  const quotaTenants = await writeImport({ tx, ch, ids, actorId: c.actor.userId }, plan.items);
  await afterLock(c.ctx.hooks, OP, "rows");
  ch.audit(importAudit(a.req, a.file.config_version, plan.items, created));
  const result = {
    config_version: a.base + 1,
    summary: plan.summary,
    secrets_created: created.length,
  };
  return { result, quotaTenants };
}

/**
 * Đụng unique/FK do ghi song song chen giữa (kể cả ghi không bump config_version) → 409 `VERSION_CONFLICT {current}`
 * (version hiện tại, có thể = base — khi đó log warn để dò ghi lệch không bump): người dùng chạy lại dry-run.
 * Không để rơi thành 500. Lỗi khác ném lại.
 */
export async function mapRace(c: ImportCall, err: unknown, base?: number): Promise<never> {
  if (uniqueViolation(err) || foreignKeyViolation(err)) {
    const cur = await withScope(c.ctx.db, c.scope, (tx) => readConfigVersion(tx));
    if (cur === base)
      logger.warn("import unique/FK without version move", {
        module: "transfer",
        ...safeErrorFields(err),
      });
    throw appError("VERSION_CONFLICT", { current: cur });
  }
  return mapVersionMoved(err);
}

export async function applyImport(c: ImportCall, req: ImportRequest): Promise<ImportResult> {
  const base = req.base_config_version;
  if (base === undefined)
    throw validationError([
      { path: ["base_config_version"], code: "required", message: "Required when dry_run=0" },
    ]);
  checkImportSize(req.content);
  const parsed = parseConfigText(req.content);
  if (!parsed.file) throw appError("IMPORT_INVALID", { errors: parsed.errors });
  const args: Args = { req, base, file: parsed.file };
  const out = await configWrite({ ...c, expectBase: base }, OP, (tx, ch) =>
    applyInTx(c, args, tx, ch),
  ).catch((err) => mapRace(c, err, base));
  for (const id of out.quotaTenants) {
    void evaluateTenant(c.ctx, id).catch((err) =>
      logger.error("quota evaluate failed", { module: "transfer", ...safeErrorFields(err) }),
    );
  }
  return out.result;
}
