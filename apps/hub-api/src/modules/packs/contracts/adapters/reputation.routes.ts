// V2-E · DT-01..04 · CD-02..05 · HD-06 · CR-096 Q1: route uy tín v2 dưới `/pack/contracts/reputation`. Guard quyền gói TRƯỚC đọc thân
// (viewer ghi ⇒ 403, 0 SQL); cấu hình chỉ quản lý (`admin`); ô lạ ⇒ 404; thân/tham số sai ⇒ 400; luật sai ⇒ 422. Không đầu vào nào 500.
import {
  RepCellConfigSchema,
  RepGroupSchema,
  RepHistoryQuerySchema,
  RepJobSchema,
  RepJobTypesSchema,
  RepMineQuerySchema,
  RepPartnerQuerySchema,
  RepPartnersQuerySchema,
  RepPreviewSchema,
  RepRatingSchema,
  RepRoleSchema,
  RepSettingsSchema,
} from "@ai/contracts";
import { type Context, Hono } from "hono";
import type { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseQuery, parseWith, readJson } from "../../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  packAccessInput,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import { checkPackAccess } from "../../kit/domain/pack-access.rules";
import { RepFail, type ReputationUsecase } from "../application/reputation.usecase";
import type { ReputationWriteUsecase } from "../application/reputation-write.usecase";

const KEY = "contracts";
const P = "/reputation";

function fail(e: unknown): never {
  if (!(e instanceof RepFail)) throw e;
  if (e.kind === "not_found") throw appError("NOT_FOUND");
  if (e.kind === "forbidden") throw new AppError("PACK_FORBIDDEN", 403, e.detail);
  throw new AppError("REPUTATION_INVALID", 422, e.detail);
}
const run = <T>(p: Promise<T>): Promise<T> => p.catch(fail);
const who = (c: Context<PackGuardVars>) => {
  const u = c.get("user");
  return { tenantId: u.tenantId, userId: u.userId };
};
const body = async <S extends z.ZodType>(c: Context, s: S): Promise<z.output<S>> =>
  parseWith(s, await readJson(c));
/** Ô trên đường dẫn: nhóm/vai lạ ⇒ 404. */
const cellOf = (c: Context) => {
  const g = RepGroupSchema.safeParse(c.req.param("group"));
  const r = RepRoleSchema.safeParse(c.req.param("role"));
  if (!g.success || !r.success) throw appError("NOT_FOUND");
  return [g.data, r.data] as const;
};

export function reputationRoutes(
  view: PackAccessView,
  uc: ReputationUsecase,
  wr: ReputationWriteUsecase,
): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const read = packGuard(view, KEY, "read");
  const write = packGuard(view, KEY, "write");
  r.get(`${P}/partners`, read, async (c) =>
    c.json(await run(uc.list(who(c), parseQuery(c, RepPartnersQuerySchema).role))),
  );
  r.get(`${P}/partner`, read, async (c) => {
    const q = parseQuery(c, RepPartnerQuerySchema);
    return c.json(await run(uc.one(who(c), q.party, q.role)));
  });
  r.get(`${P}/mine`, read, async (c) =>
    c.json(await run(uc.mine(who(c), Number(parseQuery(c, RepMineQuerySchema).days)))),
  );
  r.get(`${P}/history`, read, async (c) => {
    const q = parseQuery(c, RepHistoryQuerySchema);
    return c.json(await run(uc.history(who(c), q.party, q.role, Number(q.months))));
  });
  r.get(`${P}/ratings`, read, async (c) => {
    const q = parseQuery(c, RepPartnerQuerySchema);
    return c.json(await run(wr.ratings(who(c), q.party, q.role)));
  });
  r.post(`${P}/ratings`, write, async (c) =>
    c.json(await run(wr.rate(who(c), await body(c, RepRatingSchema))), 201),
  );
  r.post(`${P}/jobs`, write, async (c) =>
    c.json(await run(wr.logJob(who(c), await body(c, RepJobSchema))), 201),
  );
  configRoutes(r, view, uc);
  return r;
}

/** Cấu hình điểm: đọc/xem trước theo quyền đọc; lưu cần `admin` (quản lý). */
function configRoutes(r: Hono<PackGuardVars>, view: PackAccessView, uc: ReputationUsecase): void {
  const read = packGuard(view, KEY, "read");
  const write = packGuard(view, KEY, "write");
  const admin = async (c: Context<PackGuardVars>) => {
    const i = await packAccessInput(view, KEY, c.get("user"));
    if (checkPackAccess({ ...i, grantedGroupIds: i.grantedByAction.admin }) !== "ok")
      throw new AppError("PACK_FORBIDDEN", 403, "Chỉ quản lý được chỉnh cách tính điểm");
  };
  r.get(`${P}/config`, read, async (c) => c.json(await run(uc.getConfig(who(c)))));
  r.post(`${P}/config/preview`, read, async (c) =>
    c.json(await run(uc.preview(who(c), await body(c, RepPreviewSchema)))),
  );
  r.put(`${P}/config/cells/:group/:role`, write, async (c) => {
    const [g, role] = cellOf(c);
    await admin(c);
    return c.json(await run(uc.saveCell(who(c), g, role, await body(c, RepCellConfigSchema))));
  });
  r.put(`${P}/config/settings`, write, async (c) => {
    await admin(c);
    return c.json(await run(uc.saveSettings(who(c), await body(c, RepSettingsSchema))));
  });
  r.put(`${P}/config/job-types`, write, async (c) => {
    await admin(c);
    return c.json(await run(uc.saveJobTypes(who(c), await body(c, RepJobTypesSchema))));
  });
}
