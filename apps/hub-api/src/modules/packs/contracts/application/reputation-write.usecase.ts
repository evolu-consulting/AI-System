// V2-E · DT-04 · HD-06 · §5.1i: đánh giá thủ công 1–5 sao từng tiêu chí (lệch hơn `reason_gap` điểm so với dữ liệu ⇒ bắt lý do;
// nhiều người ⇒ lượt mới nhất của mỗi người) và ghi việc phát sinh theo danh mục "Loại việc". Chỉ thêm.

import type { PackUow, PackWho } from "../../kit/application/ports";
import { scoreCells } from "../domain/rep-board.rules";
import { cellKey, isCell, type RepRole } from "../domain/rep-config.rules";
import type { RepJobIn, RepRatingIn } from "../domain/reputation.types";
import type { RepRepo } from "./reputation.ports";
import { RepFail, type ReputationUsecase } from "./reputation.usecase";

type Rating = { group: string; criterion: string; stars: number; by_user: string; at: string };

/** Lượt mới nhất của mỗi người cho mỗi (nhóm, tiêu chí) — danh sách đã sắp mới nhất trước. */
export function currentRatings<T extends Rating>(all: readonly T[]): T[] {
  const seen = new Set<string>();
  return all.filter((r) => {
    const k = `${r.group}\u0001${r.criterion}\u0001${r.by_user}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Chỉ cần tx người dùng của repo uy tín (ghi chỉ thêm). */
export type RepWriteDeps = { uow: PackUow<{ rep: RepRepo }> };

/** Điểm so sánh của tiêu chí: điểm tiêu chí từ dữ liệu, chưa có thì điểm dữ liệu của ô. */
async function dataPoint(
  read: ReputationUsecase,
  who: PackWho,
  b: RepRatingIn,
): Promise<number | null> {
  const s = await read.scored(who, [b.role], b.party);
  const cell = scoreCells(s.rows, s.cfg)
    .get(`${b.party}\u0001${b.role}`)
    ?.find((c) => c.group === b.group);
  if (!cell) return null;
  const own = cell.criteria.find((c) => c.key === b.criterion && c.kind !== "manual");
  return own?.score ?? cell.data_score;
}

async function rateOne(d: RepWriteDeps, read: ReputationUsecase, who: PackWho, b: RepRatingIn) {
  if (!isCell(b.group, b.role)) throw new RepFail("not_found");
  const cfg = await read.config(who);
  const cell = cfg.cells[cellKey(b.group, b.role)];
  if (!cell.criteria.some((c) => c.enabled && c.key === b.criterion))
    throw new RepFail("invalid", "Tiêu chí không có trong cách tính điểm");
  const reason = b.reason?.trim() || null;
  const data = await dataPoint(read, who, b);
  if (!reason && data !== null && Math.abs(b.stars * 20 - data) > cfg.settings.reason_gap)
    throw new RepFail(
      "invalid",
      `Đánh giá lệch hơn ${cfg.settings.reason_gap} điểm so với dữ liệu (${data}) — cần ghi lý do`,
    );
  const row = await d.uow.tenant(who, (r) =>
    r.rep.insertRating({
      party: b.party,
      role: b.role,
      grp: b.group,
      criterion: b.criterion,
      stars: b.stars,
      reason,
    }),
  );
  if (!row) throw new RepFail("not_found");
  return row;
}

export function reputationWriteUsecase(d: RepWriteDeps, read: ReputationUsecase) {
  const rate = (who: PackWho, b: RepRatingIn) => rateOne(d, read, who, b);

  const ratings = async (who: PackWho, party: string, role: RepRole) => {
    const all = (await d.uow.tenant(who, (r) => r.rep.ratings(party, role))) as unknown as Rating[];
    return { current: currentRatings(all), history: all };
  };

  const logJob = async (who: PackWho, b: RepJobIn) => {
    if (!isCell(b.group, b.role)) throw new RepFail("not_found");
    const [cfg, today] = await Promise.all([read.config(who), read.today(who)]);
    if (!cfg.jobTypes.some((j) => j.key === b.job_type))
      throw new RepFail("invalid", "Loại việc không có trong danh mục");
    const row = await d.uow.tenant(who, (r) =>
      r.rep.insertJob({
        party: b.party,
        role: b.role,
        grp: b.group,
        job_type: b.job_type,
        at: b.at ?? today,
        note: b.note?.trim() || null,
        contract_id: b.contract_id ?? null,
      }),
    );
    if (!row) throw new RepFail("not_found");
    return row;
  };

  return { rate, ratings, logJob };
}
export type ReputationWriteUsecase = ReturnType<typeof reputationWriteUsecase>;
