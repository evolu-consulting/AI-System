// niti-onboard · nối use case onboarding với hạ tầng: `configWrite` (một tx + audit + NOTIFY sau COMMIT), repo SQL,
// `enablePack` của module packs, AppError. Test/CLI gọi `onboardTenant(db, spec, actorId)`.
import type { Db } from "@ai/db";
import { auditOf } from "../../lib/audit/audit.write";
import { configWrite } from "../../lib/config/config-write";
import { appError } from "../../lib/errors";
import { enablePack } from "../packs/packs.service";
import { NEW_TENANT_SETTINGS } from "../tenants/tenants.service";
import { type HubAssignConfig, hubProcessAssign } from "./adapters/hub-assign.adapter";
import { onboardRepo } from "./adapters/onboard.repo";
import { type OnboardReport, onboardTenant as run } from "./application/onboard.usecase";
import type { OnboardPorts } from "./application/ports";
import type { OnboardSpec } from "./domain/onboard.rules";

export type { OnboardReport };

export function onboardPorts(db: Db, actorId: string, hub?: HubAssignConfig): OnboardPorts {
  const call = { ctx: { db }, scope: { kind: "platform" } as const, actor: { userId: actorId } };
  return {
    ...(hub ? { processAssign: hubProcessAssign(hub) } : {}),
    write: (fn) =>
      configWrite(call, "tenant.save", (tx, ch) =>
        fn(onboardRepo(tx), {
          changed: (entity, tenantId) => ch.changed({ entity, tenantId }),
          audit: (a) =>
            ch.audit(
              auditOf(a.op, "tenant", {
                entityId: a.entityId,
                entityName: a.entityName,
                tenantId: a.tenantId,
                before: null,
                after: null,
                summary: a.summary,
              }),
            ),
        }),
      ),
    enablePack: async (tenantId, packKey) => ({
      groups: (await enablePack(call, tenantId, packKey)).groups.length,
    }),
    newTenantSettings: NEW_TENANT_SETTINGS,
    fail: (code, details) => appError(code, details),
  };
}

export const onboardTenant = (
  db: Db,
  s: OnboardSpec,
  actorId: string,
  hub?: HubAssignConfig,
): Promise<OnboardReport> => run(onboardPorts(db, actorId, hub), s, actorId);
