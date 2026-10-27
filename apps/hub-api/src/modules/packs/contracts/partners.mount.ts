// HD8-FR-01…09 (lớp 4 của gói): nối đối tác / điểm uy tín / so giá hàng hoá / kiểm link báo giá / danh bạ công ty — `PackUow` role
// `contracts_rw` (chỉ phạm vi người dùng, D8-04) + repo + use case + route. Múi tenant qua `safeTimeZone` của HD4; tra MST qua cổng
// `TaxRegistry` của HD2 (null ⇒ "chưa tra được"). REP-v3: điểm gợi ý đối tác + NCC lấy engine hiện hành theo cờ (`rep-current.mount.ts`).
import type { Db, Tx } from "@ai/db";
import { Hono } from "hono";
import type { Redis } from "ioredis";
import type { AiClient } from "../../../lib/ai-client/ai-client";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow, packTenantOnly } from "../kit/adapters/pack-uow";
import { companiesRepo } from "./adapters/companies.repo";
import { companiesRoutes } from "./adapters/companies.routes";
import { createInspect } from "./adapters/link-check.http";
import { LINK_CHECKS_PER_MINUTE, linkCheckLimit } from "./adapters/link-check-limit.redis";
import { partnerRolesRepo } from "./adapters/partner-roles.repo";
import { partnerRolesRoutes } from "./adapters/partner-roles.routes";
import { PARTNER_SEARCH_MODEL, partnerWebSearch } from "./adapters/partner-web-search";
import { partnersRepo } from "./adapters/partners.repo";
import { partnersRoutes } from "./adapters/partners.routes";
import { partnerDataOf } from "./adapters/partners-data.repo";
import { companiesUsecase } from "./application/companies.usecase";
import type { TaxRegistry } from "./application/extraction.ports";
import { partnerRolesUsecase } from "./application/partner-roles.usecase";
import { partnersUsecase } from "./application/partners.usecase";
import type { Inspect } from "./domain/link-check.rules";
import type { RepEngine } from "./domain/rep-current.rules";
import { safeTimeZone } from "./reminders.mount";
import { repCurrent } from "./rep-current.mount";

const KEY = "contracts";

export type PartnersModuleDeps = {
  timeZoneOf: (tenantId: string) => Promise<string>;
  now?: () => Date;
  /** Test: trang giả thay mạng thật. */
  inspect?: Inspect;
  tax?: TaxRegistry | null;
  /** Trần kiểm link theo người dùng (Redis; vắng ⇒ 503 khi kiểm link). */
  redis?: Redis;
  linkChecksPerMinute?: number;
  /** V2-I · Q8: AI client chung cho "Tìm trên internet" (vắng ⇒ 503 AGENT_UNAVAILABLE). */
  ai?: AiClient | null;
  /** REP-v3 · cờ engine điểm (vắng ⇒ env `REPUTATION_ENGINE`). */
  engine?: () => RepEngine;
};

const partnersUow = (db: Db) =>
  packTenantOnly(
    createPackUow(db, KEY, (tx: Tx, t: string) => ({
      partners: partnersRepo(tx, t),
      companies: companiesRepo(tx, t),
      roles: partnerRolesRepo(tx, t),
    })),
  );

/** V2-J2 · điểm uy tín vai NCC cho tab "NCC & giá" — engine hiện hành theo cờ (REP-v3, `rep-current.mount.ts`). */
export const supplierScores = (db: Db, d: Pick<PartnersModuleDeps, "timeZoneOf" | "now">) =>
  repCurrent(db, d).supplierScores;

export function partnersModule(
  db: Db,
  view: PackAccessView,
  d: PartnersModuleDeps,
): Hono<PackGuardVars> {
  const uow = partnersUow(db);
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
  const cur = repCurrent(db, d);
  r.route("/", partnersRoutes(view, uc, limit, cur.engine));
  r.route("/", companiesRoutes(view, companiesUsecase({ uow, tax: d.tax ?? null })));
  const search = d.ai
    ? partnerWebSearch(d.ai, {
        model: process.env.CONTRACTS_PARTNER_SEARCH_MODEL?.trim() || PARTNER_SEARCH_MODEL,
      })
    : null;
  const roles = partnerRolesUsecase({
    uow,
    scoreOf: cur.scoreOf, // REP-v3: engine hiện hành theo cờ
    timeZoneOf: safeTimeZone(d.timeZoneOf),
    now: d.now ?? (() => new Date()),
    webSearch: search,
  });
  r.route("/", partnerRolesRoutes(view, roles, limit));
  return r;
}
