// REP-v3 · CR-101b (lớp 4 của gói): điểm uy tín HIỆN HÀNH theo cờ `REPUTATION_ENGINE` (`v2e` = BA v2.0 §5.1; vắng/khác = `hd8`,
// mặc định TẮT trên prod). Cờ đọc MỖI lần gọi (đổi env không cần dựng lại module; test bật/tắt giữa hai yêu cầu). Nguồn điểm dùng
// chung cho tab "NCC & giá" (`supplierScores`), gợi ý đối tác (V2-C `scoreOf`) và xem trước "N đối tác đổi mức nếu bật" (chỉ đọc).
// Không import `partners.mount`/`reputation.mount` (tránh vòng phụ thuộc) — tự dựng hai use case đọc từ adapter.
import type { Db } from "@ai/db";
import { createPackUow, packTenantOnly } from "../kit/adapters/pack-uow";
import type { PackWho } from "../kit/application/ports";
import { createInspect } from "./adapters/link-check.http";
import { partnersRepo } from "./adapters/partners.repo";
import { partnerDataOf } from "./adapters/partners-data.repo";
import { repRepo } from "./adapters/rep.repo";
import { rowsOf } from "./adapters/rep.sql";
import type { ScoreOf } from "./application/partner-roles.usecase";
import { PartnersFail, partnersUsecase } from "./application/partners.usecase";
import { reputationUsecase } from "./application/reputation.usecase";
import { type RepEngine, repEngineOf, switchDiff } from "./domain/rep-current.rules";
import { safeTimeZone } from "./reminders.mount";

const KEY = "contracts";

/** Cờ engine từ env (đọc mỗi lần gọi). */
export const envRepEngine = (): RepEngine => repEngineOf(process.env.REPUTATION_ENGINE);

export type RepCurrentDeps = {
  timeZoneOf: (tenantId: string) => Promise<string>;
  now?: () => Date;
  engine?: () => RepEngine;
};

/** Use case đọc V2-E (phạm vi người dùng, RLS). */
export function v2eReads(db: Db, d: Pick<RepCurrentDeps, "timeZoneOf" | "now">) {
  return reputationUsecase({
    uow: packTenantOnly(createPackUow(db, KEY, (tx, t) => ({ rep: repRepo(tx, t) }))),
    timeZoneOf: safeTimeZone(d.timeZoneOf),
    now: d.now ?? (() => new Date()),
    merge: rowsOf,
  });
}

function hd8Reads(db: Db, d: Pick<RepCurrentDeps, "timeZoneOf" | "now">) {
  return partnersUsecase({
    uow: packTenantOnly(createPackUow(db, KEY, (tx, t) => ({ partners: partnersRepo(tx, t) }))),
    timeZoneOf: safeTimeZone(d.timeZoneOf),
    now: d.now ?? (() => new Date()),
    inspect: createInspect(),
    combine: partnerDataOf,
  });
}

const bandOf = (l: string) => (l === "good" || l === "fair" || l === "watch" ? l : null);

export function repCurrent(db: Db, d: RepCurrentDeps) {
  const engine = d.engine ?? envRepEngine;
  const v2e = v2eReads(db, d);
  const hd8 = hd8Reads(db, d);

  /** V2-J2 · điểm vai NCC theo khoá đối tác cho tab "NCC & giá"; chưa đủ việc ⇒ `new`. */
  const supplierScores = async (who: PackWho) =>
    engine() === "v2e"
      ? new Map(
          (await v2e.list(who, "supplier")).map((p) => [
            p.party,
            { score: p.score, level: p.level },
          ]),
        )
      : new Map(
          (await hd8.list(who, "supplier")).map((p) => [
            p.party,
            { score: p.score, level: p.band ?? ("new" as const) },
          ]),
        );

  /** V2-C gợi ý đối tác. HD8: bên trả HH tính như Khách (CR-097a Q3); V2-E: vai riêng (R23). Chưa có điểm ⇒ null. */
  const scoreOf: ScoreOf = async (who, party, role) => {
    if (engine() === "v2e") {
      const p = await v2e.scoreOne(who, party, role);
      return p ? { score: p.score, band: bandOf(p.level) } : null;
    }
    const p = await hd8
      .one(who, party, role === "commission_payer" ? "customer" : role)
      .catch((e: unknown) => {
        if (e instanceof PartnersFail && e.kind === "not_found") return null;
        throw e;
      });
    return p ? { score: p.score, band: p.band } : null;
  };

  /** "N đối tác đổi mức nếu bật": HD8 hiện hành vs V2-E, song song (3 + 3 câu cố định), KHÔNG ghi. */
  const switchPreview = async (who: PackWho) => {
    const [h, v] = await Promise.all([hd8.byRole(who), v2e.list(who, "all")]);
    return { engine: engine(), ...switchDiff(h, v) };
  };

  return { engine, supplierScores, scoreOf, switchPreview };
}
export type RepCurrent = ReturnType<typeof repCurrent>;
