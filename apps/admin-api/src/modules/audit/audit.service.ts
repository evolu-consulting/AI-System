// ADM-FR-51, ADM-BR-09 · M4-R12 · đọc audit (plan §4.3). Không biết HTTP. `restorable` tính theo người gọi
// (`canRestore`); khôi phục (POST /:id/restore) ở `audit.restore.ts`.
import {
  type AuditDetail,
  type AuditItem,
  type AuditListQuery,
  type AuditListResponse,
  type AuditSummary,
  AuditSummarySchema,
} from "@ai/contracts";
import { type Db, type DbScope, withScope } from "@ai/db";
import type { Actor } from "../../lib/auth-middleware";
import { appError } from "../../lib/errors";
import { validationError } from "../../lib/http";
import * as repo from "./audit.repo";
import {
  type AuditFilter,
  auditRange,
  canRestore,
  decodeCursor,
  encodeCursor,
  resolveAuditFilter,
} from "./audit.rules";

export type AuditCtx = { db: Db };
export type Call = { ctx: AuditCtx; actor: Actor; scope: DbScope };

const SUMMARY_KEYS = Object.keys(AuditSummarySchema.shape) as (keyof AuditSummary)[];

/** Chỉ trả khoá có trong contract `AuditSummary` (hàng cũ/khoá nội bộ như `subject_id` của grant bị bỏ). */
function pickSummary(s: Record<string, unknown>): AuditSummary {
  const out: Record<string, unknown> = {};
  for (const k of SUMMARY_KEYS) if (s[k] !== undefined && s[k] !== null) out[k] = s[k];
  return out as AuditSummary;
}

export function toAuditItem(r: repo.AuditRow, actor: Actor): AuditItem {
  return {
    id: r.id,
    at: r.at.toISOString(),
    tenant_id: r.tenantId,
    tenant_key: r.tenantKey,
    actor_id: r.actorId,
    actor_username: r.actorUsername,
    action: r.action,
    entity: r.entity,
    entity_id: r.entityId,
    entity_name: r.entityName,
    config_version: r.configVersion,
    entity_version: r.entityVersion,
    summary: pickSummary(r.summary ?? {}),
    restorable: canRestore(actor.role, r),
  };
}

function filterOf(actor: Actor, tenantParam: string | undefined): AuditFilter {
  const f = resolveAuditFilter(actor, tenantParam);
  if (f === "not_found") throw appError("NOT_FOUND");
  return f;
}

const badQuery = (path: string, message: string) =>
  validationError([{ path: [path], code: "custom", message }]);

export async function listAudit(call: Call, q: AuditListQuery): Promise<AuditListResponse> {
  const scope = filterOf(call.actor, q.tenant_id);
  const range = auditRange(q, new Date());
  if (range === "invalid") throw badQuery("from", "from after to");
  const cursor = q.cursor === undefined ? null : decodeCursor(q.cursor);
  if (q.cursor !== undefined && cursor === null) throw badQuery("cursor", "invalid cursor");
  const rows = await withScope(call.ctx.db, call.scope, (tx) =>
    repo.listAudit(tx, {
      scope,
      entity: q.entity,
      action: q.action,
      actorId: q.actor_id,
      entityId: q.entity_id,
      q: q.q,
      ...range,
      cursor,
      limit: q.limit,
    }),
  );
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => toAuditItem(r, call.actor)),
    next_cursor: rows.length > q.limit && last ? encodeCursor(last.seq) : null,
  };
}

export async function getAudit(call: Call, id: string): Promise<AuditDetail> {
  const scope = filterOf(call.actor, undefined);
  const row = await withScope(call.ctx.db, call.scope, (tx) => repo.getAudit(tx, scope, id));
  if (!row) throw appError("NOT_FOUND");
  return { ...toAuditItem(row, call.actor), before: row.before, after: row.after };
}
