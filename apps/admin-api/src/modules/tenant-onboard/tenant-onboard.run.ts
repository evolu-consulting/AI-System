// niti-onboard · nối use case onboarding với hạ tầng: `configWrite` (một tx + audit + NOTIFY sau COMMIT), repo SQL,
// `enablePack` của module packs, AppError. Test/CLI gọi `onboardTenant(db, spec, actorId)`.
import { PASSWORD_MAX_LEN, PASSWORD_MIN_LEN } from "@ai/contracts/common";
import { type Db, withScope } from "@ai/db";
import { auditOf } from "../../lib/audit/audit.write";
import type { Actor as AuthActor } from "../../lib/auth-middleware";
import { configWrite } from "../../lib/config/config-write";
import { appError } from "../../lib/errors";
import { featureIdByKey, grantEntitlement } from "../features/features.entitlements";
import { setJobTitle } from "../org/org.service";
import { enablePack } from "../packs/packs.service";
import { PLATFORM_TENANT_KEY } from "../tenants/tenants.rules";
import { NEW_TENANT_SETTINGS } from "../tenants/tenants.service";
import type { Actor as UserActor } from "../users/users.rules";
import { createUser, updateUser } from "../users/users.service";
import { actorTenant, hasEntitlement, onboardRepo, readUsers } from "./adapters/onboard.repo";
import { type OnboardReport, onboardTenant as run } from "./application/onboard.usecase";
import type { OnboardPorts } from "./application/ports";
import type { OnboardSpec } from "./domain/onboard.rules";

export type { OnboardReport };

export type OnboardOpts = {
  savePassword?: (email: string, password?: string) => Promise<void>;
  probeSink?: () => Promise<void>;
  /** CR-159: mật khẩu chung cho user mới (từ `--password-env`). */
  sharedPassword?: string;
  /** false => `--no-force-change`. */
  forceChange?: boolean;
};

export function onboardPorts(db: Db, actorId: string, o: OnboardOpts = {}): OnboardPorts {
  const { savePassword, probeSink } = o;
  const scope = { kind: "platform" } as const;
  const call = { ctx: { db }, scope, actor: { userId: actorId } };
  /** Actor đầy đủ cho users.service (tenant của platform admin); tra một lần, nhớ lại. */
  let ucall:
    | Promise<{ ctx: { db: Db }; scope: typeof scope; actor: UserActor & AuthActor }>
    | undefined;
  const asUser = () =>
    (ucall ??= withScope(db, scope, (tx) => actorTenant(tx, actorId)).then((tenantId) => {
      if (!tenantId) throw appError("FORBIDDEN");
      return {
        ctx: { db },
        scope,
        actor: {
          userId: actorId,
          tenantId,
          role: "platform_admin",
          tenantKey: PLATFORM_TENANT_KEY,
          sid: null,
        },
      };
    }));
  return {
    ...(savePassword ? { savePassword } : {}),
    ...(probeSink ? { probeSink } : {}),
    ...(o.sharedPassword ? { sharedPassword: o.sharedPassword } : {}),
    forceChange: o.forceChange !== false,
    addonKnown: async (key) =>
      (await withScope(db, scope, (tx) => featureIdByKey(tx, key))) !== null,
    readUsers: async (key, emails) => {
      await asUser();
      return emails.length === 0 ? [] : withScope(db, scope, (tx) => readUsers(tx, key, emails));
    },
    createUser: async (tenantId, u, opts) => {
      const r = await createUser(await asUser(), tenantId, { ...u, locale: "vi" }, opts);
      return { id: r.user.id, tempPassword: r.temp_password };
    },
    updateUser: async (id, version, set) => {
      await updateUser(await asUser(), id, { version, ...set });
    },
    setJobTitle: async (tenantId, userId, title) => {
      await setJobTitle(await asUser(), tenantId, userId, { job_title: title });
    },
    grantAddon: async (tenantId, key) => {
      const c = await asUser();
      const fid = await withScope(db, scope, (tx) => featureIdByKey(tx, key));
      if (!fid) throw appError("VALIDATION_ERROR", { reason: "ADDON_UNKNOWN", addon: key });
      const had = await withScope(db, scope, (tx) => hasEntitlement(tx, fid, tenantId));
      await grantEntitlement(c, fid, tenantId);
      return !had;
    },
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

/** Mật khẩu chung sai độ dài => lỗi TRƯỚC mọi câu ghi (thông báo không chứa mật khẩu). */
export const sharedPasswordIssue = (pw: string): boolean =>
  pw.length < PASSWORD_MIN_LEN || pw.length > PASSWORD_MAX_LEN;

export async function onboardTenant(
  db: Db,
  s: OnboardSpec,
  actorId: string,
  o: OnboardOpts = {},
): Promise<OnboardReport> {
  if (o.sharedPassword !== undefined && sharedPasswordIssue(o.sharedPassword))
    throw appError("VALIDATION_ERROR", {
      reason: "PASSWORD_LENGTH",
      min: PASSWORD_MIN_LEN,
      max: PASSWORD_MAX_LEN,
    });
  return run(onboardPorts(db, actorId, o), s, actorId);
}
