// ADM-FR-40, ADM-FR-51 · M4-R02, R03, R10 · Q9 · quota tháng của tenant (plan-contract §2.1, plan §4.2, §6 Quota PUT).
// GET: bộ quota + mức dùng tháng VN. PUT: thay cả bộ theo `version` tenant; no-op (bộ normalize bằng bộ cũ) → không
// bump/audit/NOTIFY/evaluate; đổi thật → tenant version+1, `updated_by`, audit snapshot, sau commit evaluator chạy nền.
import type { QuotaItemInput, QuotaSetRequest, QuotaSetResponse, QuotaStatus } from "@ai/contracts";
import { type Db, type DbScope, type Tx, withScope } from "@ai/db";
import type { InTx } from "../../lib/audit/audit.write";
import { auditOf } from "../../lib/audit/audit.write";
import { configWrite } from "../../lib/config/config-write";
import { appError } from "../../lib/errors";
import { validationError } from "../../lib/http";
import { logger } from "../../lib/logger";
import { safeErrorFields } from "../../lib/pg-errors";
import { afterLock, type TestHooks } from "../../lib/test-hooks";
import { evaluateTenant } from "./quotas.evaluator";
import * as repo from "./quotas.repo";
import {
  duplicateFeatureIndex,
  evaluateQuota,
  monthRange,
  normalizeQuotaItems,
  sameQuotaSet,
} from "./quotas.rules";

export type QuotasCtx = { db: Db; now: () => Date; hooks?: TestHooks };
export type QuotasCall = { ctx: QuotasCtx; scope: DbScope; actor: { userId: string } };

const NULL_ROW: repo.QuotaDbRow = {
  feature_id: null,
  feature_key: null,
  feature_name: null,
  max_runs: null,
  max_tokens: null,
  max_usd: null,
};

const limitsOf = (r: QuotaItemInput): QuotaItemInput => ({
  feature_id: r.feature_id,
  max_runs: r.max_runs,
  max_tokens: r.max_tokens,
  max_usd: r.max_usd,
});

/** Dòng audit: giới hạn + `feature_key` (đọc được khi feature đã xoá). */
const auditItems = (rows: readonly repo.QuotaDbRow[]) =>
  rows.map((r) => ({ ...limitsOf(r), feature_key: r.feature_key }));

/** Trạng thái từng dòng quota (luôn có dòng `feature_id=null` đầu) + mức dùng tháng VN hiện tại (dùng lại ở usage). */
export async function quotaStatuses(
  tx: Tx,
  tenantId: string,
  now: Date,
  saved?: repo.QuotaDbRow[],
): Promise<{ month: string; items: QuotaStatus[] }> {
  const rows = saved ?? (await repo.listQuotas(tx, tenantId));
  const all = rows[0]?.feature_id === null ? rows : [NULL_ROW, ...rows];
  const range = monthRange(now);
  const usage = await repo.monthUsage(tx, tenantId, range);
  const evals = evaluateQuota({
    quotas: all.map((r) => ({
      featureId: r.feature_id,
      maxRuns: r.max_runs,
      maxTokens: r.max_tokens,
      maxUsd: r.max_usd,
    })),
    ...usage,
  });
  const items = all.map((r, i): QuotaStatus => {
    const e = evals[i] as (typeof evals)[number];
    const u = e.used;
    return {
      ...limitsOf(r),
      feature_key: r.feature_key,
      feature_name: r.feature_name,
      used: {
        runs: u.runs,
        tokens: u.tokens,
        billable_usd: u.billableUsd,
        unpriced_rows: u.unpricedRows,
      },
      pct: e.pct,
      level: e.level,
    };
  });
  return { month: range.month, items };
}

/** `QuotaSetResponse` từ bộ đang lưu + mức dùng tháng hiện tại. */
async function buildResponse(
  { tx }: { tx: Tx; scope: DbScope },
  t: repo.QuotaTenant,
  now: Date,
  saved?: repo.QuotaDbRow[],
): Promise<QuotaSetResponse> {
  const { month, items } = await quotaStatuses(tx, t.id, now, saved);
  return {
    tenant_id: t.id,
    version: t.version,
    month,
    // R09 · theo tenant đang xem cho mọi scope (review M4 vòng 2).
    has_usage_data: await repo.hasUsageData(tx, t.id),
    items,
  };
}

async function mustTenant(tx: Tx, id: string, lock: boolean): Promise<repo.QuotaTenant> {
  const t = await repo.findTenant(tx, id, lock);
  if (!t) throw appError("NOT_FOUND");
  return t;
}

export async function getQuotas(c: QuotasCall, id: string): Promise<QuotaSetResponse> {
  return withScope(c.ctx.db, c.scope, async (tx) =>
    buildResponse({ tx, scope: c.scope }, await mustTenant(tx, id, false), c.ctx.now()),
  );
}

/** 400 trước khi mở transaction: trùng `feature_id` (null là một giá trị). */
export function checkItems(items: readonly QuotaItemInput[]): void {
  const dup = duplicateFeatureIndex(items);
  if (dup === null) return;
  throw validationError([
    { path: ["items", dup, "feature_id"], code: "duplicate", message: "Duplicate feature_id" },
  ]);
}

/** Khoá feature cũ ∪ mới (SHARE, hạng 8); feature mới không tồn tại → INVALID_REFERENCE. */
async function lockFeatures(tx: Tx, tenantId: string, items: readonly QuotaItemInput[]) {
  const wanted = items.flatMap((x) => (x.feature_id ? [x.feature_id] : []));
  const old = await repo.quotaFeatureIds(tx, tenantId);
  const found = await repo.shareFeatures(tx, [...old, ...wanted]);
  const missing = wanted.filter((f) => !found.has(f));
  if (missing.length > 0)
    throw appError("INVALID_REFERENCE", { field: "feature_id", ids: missing });
}

/** PUT thay cả bộ (plan-contract §2.1 thứ tự): version → normalize/so → ghi + bump + audit; đổi thật → evaluate nền. */
export async function putQuotas(
  c: QuotasCall,
  id: string,
  input: QuotaSetRequest,
): Promise<QuotaSetResponse> {
  checkItems(input.items);
  let changed = false;
  const out = await configWrite(c, "quota.save", async (tx, ch) => {
    const r = await putQuotasIn({ tx, ch }, c, id, input);
    changed = r.changed;
    return r.out;
  });
  if (changed) evaluateLater(c.ctx, id);
  return out;
}

/** Evaluator chạy nền sau commit (lỗi chỉ log). */
export function evaluateLater(ctx: QuotasCtx, id: string): void {
  void evaluateTenant(ctx, id).catch((err) =>
    logger.error("quota evaluate failed", { module: "quotas", ...safeErrorFields(err) }),
  );
}

/** Lõi tx của PUT (đã `checkItems`); khôi phục dùng lại (plan M4 §4.4). `changed` = đã ghi + audit. */
export async function putQuotasIn(
  w: InTx,
  c: QuotasCall,
  id: string,
  input: QuotaSetRequest,
): Promise<{ out: QuotaSetResponse; changed: boolean }> {
  const { tx, ch } = w;
  const now = c.ctx.now();
  const items = normalizeQuotaItems(input.items);
  const t = await mustTenant(tx, id, true);
  if (t.version !== input.version) {
    const current = await buildResponse({ tx, scope: c.scope }, t, now);
    throw appError("VERSION_CONFLICT", { current, updated_at: t.updated_at });
  }
  await lockFeatures(tx, id, items);
  await afterLock(c.ctx.hooks, "quota.save", "locked");
  const before = await repo.listQuotas(tx, id);
  if (sameQuotaSet(normalizeQuotaItems(before.map(limitsOf)), items)) {
    return { out: await buildResponse({ tx, scope: c.scope }, t, now, before), changed: false };
  }
  await repo.replaceQuotas(tx, id, items, c.actor.userId);
  await repo.bumpTenant(tx, id, c.actor.userId);
  ch.changed({ entity: "quota", tenantId: id });
  await afterLock(c.ctx.hooks, "quota.save", "rows");
  const after = await repo.listQuotas(tx, id);
  const t2 = { ...t, version: t.version + 1 };
  ch.audit(
    auditOf("update", "quota", {
      entityId: id,
      entityName: t.key,
      tenantId: id,
      before: { items: auditItems(before) },
      after: { items: auditItems(after) },
      entityVersion: t2.version,
      snapshot: true,
    }),
  );
  return { out: await buildResponse({ tx, scope: c.scope }, t2, now, after), changed: true };
}
