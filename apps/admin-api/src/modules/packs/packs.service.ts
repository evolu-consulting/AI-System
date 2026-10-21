// PK-FR-05 · D-05 · N1 plan §2 "Route admin-api", §5 "Bật gói": bật/tắt gói nghiệp vụ cho tenant (platform admin).
// Bật = một tx `configWrite`: khoá 3 feature · upsert 3 entitlement · 3 Group vai · 6 grant · trợ lý gói (Hub, UAT B4:
// `packs.grant_agents` khoá + bump `hub.config_meta`, NOTIFY `hub_config_changed` trong tx) · đọc lại Group · bump + audit
// (chỉ khi có đổi — bất biến M3-R15/M4 sự kiện ⇔ audit) · NOTIFY `config_changed` sau commit. Tắt = thu hồi 3 entitlement,
// giữ Group/grant. Audit dùng enum M4 sẵn có (`grant`/`revoke` · entity `entitlement`, summary `op: pack.enable|disable`).
import type { PackListResponse, PackState } from "@ai/contracts";
import { type AuditInput, type DbScope, type Tx, withScope } from "@ai/db";
import { auditOf } from "../../lib/audit/audit.write";
import { type ConfigCall, configWrite } from "../../lib/config/config-write";
import { AppError, appError } from "../../lib/errors";
import { afterLock } from "../../lib/test-hooks";
import * as repo from "./packs.repo";
import {
  isInstalled,
  packFeatureKeys,
  packGroupKeys,
  packState,
  roleGrantPairs,
  roleGroupRows,
} from "./packs.rules";

export type PacksCall = ConfigCall;
const LIST_LIMIT = 50;

/** Tenant lạ ⇒ 404 NOT_FOUND; gói chưa cài (thiếu feature) ⇒ 404 PACK_NOT_FOUND. Trả 3 feature đã khoá. */
async function target(c: PacksCall, tx: Tx, tenantId: string, k: string) {
  if (!(await repo.tenantExists(tx, tenantId))) throw appError("NOT_FOUND");
  const feats = await repo.lockPackFeatures(tx, packFeatureKeys(k));
  if (!isInstalled(k, feats)) throw new AppError("PACK_NOT_FOUND", 404, "Pack not installed");
  await afterLock(c.ctx.hooks, "entitlement.save", "locked");
  return feats;
}

function packAudit(
  op: "pack.enable" | "pack.disable",
  k: string,
  tenantId: string,
  feats: readonly repo.PackFeature[],
): AuditInput {
  const read = feats.find((f) => f.key.endsWith("-read")) ?? feats[0];
  const dto = { feature_id: read?.id ?? null, tenant_id: tenantId };
  return auditOf(op === "pack.enable" ? "grant" : "revoke", "entitlement", {
    entityId: read?.id ?? null,
    entityName: k,
    tenantId,
    before: op === "pack.disable" ? dto : null,
    after: op === "pack.enable" ? dto : null,
    summary: { op, pack: k, features: feats.map((f) => f.key) },
  });
}

export function listPacks(
  c: { ctx: { db: PacksCall["ctx"]["db"] }; scope: DbScope },
  tenantId: string,
): Promise<PackListResponse> {
  return withScope(c.ctx.db, c.scope, async (tx) => {
    if (!(await repo.tenantExists(tx, tenantId))) throw appError("NOT_FOUND");
    const rows = await repo.listPacks(tx, tenantId, LIST_LIMIT);
    return { items: rows.map((r) => packState(r.key, r.enabled, r.groups)) };
  });
}

/** Trợ lý của gói cho các Group vai + NOTIFY Hub (giao khi commit), cùng tx — dùng chung enablePack và importer. */
export async function grantAgentsAndNotify(
  tx: Tx,
  g: { tenantIds: readonly string[]; key: string; actorId: string },
): Promise<void> {
  const hubVersion = await repo.grantPackAgents(tx, g);
  if (hubVersion !== null) await repo.notifyHubConfig(tx, hubVersion);
}

export function enablePack(c: PacksCall, tenantId: string, k: string): Promise<PackState> {
  return configWrite(c, "entitlement.save", async (tx, ch) => {
    const feats = await target(c, tx, tenantId, k);
    const actorId = c.actor.userId;
    const ent = await repo.enableEntitlements(tx, {
      tenantId,
      featureIds: feats.map((f) => f.id),
      actorId,
    });
    const grp = await repo.insertRoleGroups(tx, { tenantId, actorId, rows: roleGroupRows(k) });
    const grants = await repo.insertRoleGrants(tx, { tenantId, actorId, pairs: roleGrantPairs(k) });
    // UAT B4: trợ lý của gói cho 3 Group vai, cùng tx (không chờ `hub:seed`); NOTIFY Hub giao khi commit.
    await grantAgentsAndNotify(tx, { tenantIds: [tenantId], key: k, actorId });
    if (ent > 0) ch.changed({ entity: "entitlement", tenantId });
    if (grp > 0) ch.changed({ entity: "group", tenantId });
    if (grants > 0) ch.changed({ entity: "grant", tenantId });
    if (ent + grp + grants > 0) ch.audit(packAudit("pack.enable", k, tenantId, feats));
    await afterLock(c.ctx.hooks, "entitlement.save", "rows");
    return packState(k, true, await repo.findGroups(tx, tenantId, packGroupKeys(k)));
  });
}

/** Đã tắt ⇒ no-op (204, không bump, không audit). */
export function disablePack(c: PacksCall, tenantId: string, k: string): Promise<void> {
  return configWrite(c, "entitlement.save", async (tx, ch) => {
    const feats = await target(c, tx, tenantId, k);
    const n = await repo.revokeEntitlements(tx, { tenantId, featureIds: feats.map((f) => f.id) });
    if (n > 0) {
      ch.changed({ entity: "entitlement", tenantId });
      ch.audit(packAudit("pack.disable", k, tenantId, feats));
    }
    await afterLock(c.ctx.hooks, "entitlement.save", "rows");
  });
}
