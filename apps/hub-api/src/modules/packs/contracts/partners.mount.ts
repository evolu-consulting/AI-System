// HD8-FR-01…09 (lớp 4 của gói): nối đối tác / điểm uy tín / so giá hàng hoá / kiểm link báo giá / danh bạ công ty — `PackUow` role
// `contracts_rw` (chỉ phạm vi người dùng, D8-04) + repo + use case + route. Múi tenant qua `safeTimeZone` của HD4; tra MST qua cổng
// `TaxRegistry` của HD2 (null ⇒ "chưa tra được").
import type { Db, Tx } from "@ai/db";
import { Hono } from "hono";
import type { Redis } from "ioredis";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow, packTenantOnly } from "../kit/adapters/pack-uow";
import { companiesRepo } from "./adapters/companies.repo";
import { companiesRoutes } from "./adapters/companies.routes";
import { createInspect } from "./adapters/link-check.http";
import { LINK_CHECKS_PER_MINUTE, linkCheckLimit } from "./adapters/link-check-limit.redis";
import { partnerRolesRepo } from "./adapters/partner-roles.repo";
import { partnerRolesRoutes } from "./adapters/partner-roles.routes";
import { partnersRepo } from "./adapters/partners.repo";
import { partnersRoutes } from "./adapters/partners.routes";
import { partnerDataOf } from "./adapters/partners-data.repo";
import { companiesUsecase } from "./application/companies.usecase";
import type { TaxRegistry } from "./application/extraction.ports";
import { partnerRolesUsecase, type ScoreOf } from "./application/partner-roles.usecase";
import { PartnersFail, partnersUsecase } from "./application/partners.usecase";
import type { Inspect } from "./domain/link-check.rules";
import { safeTimeZone } from "./reminders.mount";

const KEY = "contracts";

/** V2-C gợi ý đối tác: điểm HD8 hiện hành (khách/NCC); đối tác chưa có điểm / vai bên trả HH ⇒ null (V2-E thay engine). */
const scoreOf =
  (uc: ReturnType<typeof partnersUsecase>): ScoreOf =>
  async (who, party, role) => {
    if (role === "commission_payer") return null;
    const p = await uc.one(who, party, role).catch((e: unknown) => {
      if (e instanceof PartnersFail && e.kind === "not_found") return null;
      throw e;
    });
    return p ? { score: p.score, band: p.band } : null;
  };

export function partnersModule(
  db: Db,
  view: PackAccessView,
  d: {
    timeZoneOf: (tenantId: string) => Promise<string>;
    now?: () => Date;
    /** Test: trang giả thay mạng thật. */
    inspect?: Inspect;
    tax?: TaxRegistry | null;
    /** Trần kiểm link theo người dùng (Redis; vắng ⇒ 503 khi kiểm link). */
    redis?: Redis;
    linkChecksPerMinute?: number;
  },
): Hono<PackGuardVars> {
  const uow = packTenantOnly(
    createPackUow(db, KEY, (tx: Tx, t: string) => ({
      partners: partnersRepo(tx, t),
      companies: companiesRepo(tx, t),
      roles: partnerRolesRepo(tx, t),
    })),
  );
  const uc = partnersUsecase({
    uow,
    timeZoneOf: safeTimeZone(d.timeZoneOf),
    now: d.now ?? (() => new Date()),
    inspect: d.inspect ?? createInspect(),
    combine: partnerDataOf,
  });
  const r = new Hono<PackGuardVars>();
  const limit = linkCheckLimit({
    ...(d.redis ? { redis: d.redis } : {}),
    limit: d.linkChecksPerMinute ?? LINK_CHECKS_PER_MINUTE,
  });
  r.route("/", partnersRoutes(view, uc, limit));
  r.route("/", companiesRoutes(view, companiesUsecase({ uow, tax: d.tax ?? null })));
  r.route("/", partnerRolesRoutes(view, partnerRolesUsecase({ uow, scoreOf: scoreOf(uc) })));
  return r;
}
