// ADM-FR-52 · M4-R13 · Q7, Q8 · POST /admin/audit/:id/restore (plan M4 §4.4, plan-contract §2.4). Một `configWrite`:
// đọc dòng audit (scope platform) → `canRestore` → adapter `<m>.restore.ts` chạy lõi PATCH/POST/PUT của module trong
// cùng tx. Sink bọc lại: hàng audit lõi ghi thành `restore` (`restored_from`, `restored_version`, snapshot) với id đặt
// trước để trả `audit_id`; sự kiện giữ nguyên (1 NOTIFY của entity gốc sau commit). Khoá: đúng chuỗi của module (§6).
import type { AuditEntity, AuditRestoreResponse } from "@ai/contracts";
import type { AuditInput, ConfigSink, DbScope, Tx } from "@ai/db";
import type { Actor } from "../../lib/auth-middleware";
import { configWrite } from "../../lib/config/config-write";
import { appError } from "../../lib/errors";
import { uniqueViolation } from "../../lib/pg-errors";
import type { TestHooks } from "../../lib/test-hooks";
import { restoreCommand } from "../commands/commands.restore";
import { restoreFeature } from "../features/features.restore";
import { restoreGroup } from "../groups/groups.restore";
import type { EvaluatorCtx } from "../quotas/quotas.evaluator";
import { restoreQuota } from "../quotas/quotas.restore";
import { evaluateLater } from "../quotas/quotas.service";
import { restoreWorkflow } from "../workflows/workflows.restore";
import * as repo from "./audit.repo";
import type { Restored, RestoreEntry } from "./audit.restore-kit";
import { canRestore } from "./audit.rules";

export type RestoreCtx = EvaluatorCtx & { hooks?: TestHooks };
export type RestoreCall = { ctx: RestoreCtx; actor: Actor; scope: DbScope };

type Adapter = (tx: Tx, ch: ConfigSink, c: RestoreCall, e: RestoreEntry) => Promise<Restored>;
const ADAPTERS: Partial<Record<AuditEntity, Adapter>> = {
  command: restoreCommand,
  workflow: restoreWorkflow,
  feature: restoreFeature,
  group: restoreGroup,
  quota: restoreQuota,
};

/** Hàng audit của lõi → `restore`; đếm để bắt lõi không đổi gì (no-op → không có gì để khôi phục). */
function restoreSink(ch: ConfigSink, e: RestoreEntry, auditId: string) {
  let audits = 0;
  const summary = {
    restored_from: e.id,
    ...(e.entityVersion === null ? {} : { restored_version: e.entityVersion }),
  };
  const sink: ConfigSink = {
    changed: (ev) => ch.changed(ev),
    audit: (a: AuditInput) => {
      audits += 1;
      ch.audit({
        ...a,
        id: auditId,
        action: "restore",
        snapshot: true,
        summary: { ...a.summary, ...summary },
      });
    },
  };
  return { sink, audits: () => audits };
}

/** Hai lần khôi phục cùng bản đã xoá chạy đua: lần sau đụng PK → bản đã có lại → NOT_RESTORABLE. */
function mapReinsertRace(err: unknown): never {
  if (uniqueViolation(err)?.endsWith("_pkey")) throw appError("NOT_RESTORABLE");
  throw err;
}

async function entryOf(
  tx: Tx,
  c: RestoreCall,
  id: string,
): Promise<RestoreEntry & { entity: AuditEntity }> {
  const row = await repo.getAudit(tx, { kind: "all" }, id);
  if (!row) throw appError("NOT_FOUND");
  if (!canRestore(c.actor.role, row) || !row.entityId || !row.before)
    throw appError("NOT_RESTORABLE");
  return {
    id: row.id,
    entity: row.entity,
    action: row.action,
    entityId: row.entityId,
    tenantId: row.tenantId,
    entityVersion: row.entityVersion,
    latest: row.latest,
    before: row.before,
  };
}

export async function restoreAudit(c: RestoreCall, id: string): Promise<AuditRestoreResponse> {
  const auditId = Bun.randomUUIDv7();
  const r = await configWrite(c, "audit.restore", async (tx, ch) => {
    const e = await entryOf(tx, c, id);
    const adapter = ADAPTERS[e.entity];
    if (!adapter) throw appError("NOT_RESTORABLE");
    const w = restoreSink(ch, e, auditId);
    const out = await adapter(tx, w.sink, c, e).catch(mapReinsertRace);
    if (w.audits() === 0) throw appError("NOT_RESTORABLE");
    return { entity: e.entity, entityId: e.entityId, version: out.version };
  });
  if (r.entity === "quota") evaluateLater(c.ctx, r.entityId);
  return { entity: r.entity, entity_id: r.entityId, version: r.version, audit_id: auditId };
}
