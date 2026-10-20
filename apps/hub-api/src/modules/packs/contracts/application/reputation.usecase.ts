// V2-E · BA v2 §5.1 · §6 · DT-01..04 · CD-02..05 · HD-06 · CR-096 Q1: uy tín v2 — bảng điểm, chi tiết, lịch sử 3/6/12 tháng, cấu
// hình + thử tính, đánh giá sao, ghi việc. Điểm hiện tại tính khi đọc (một câu gom theo tập, Luật 4c) ⇒ đổi cấu hình chỉ đổi điểm
// hiện tại; kỳ đã chốt đọc từ `score_locks`, không tính lại. Đọc bảng điểm: cấu hình (một câu) rồi hai câu chấm song song — 3 tx, số
// câu cố định.
import type { RepCellConfigIn, RepJobTypesIn, RepPreviewIn, RepSettingsIn } from "@ai/contracts";
import type { PackUow, PackWho } from "../../kit/application/ports";
import type { RepRepo } from "../adapters/rep.repo";
import type { AggPart, FactPart, ScoreRows } from "../adapters/rep.sql";
import { localDate } from "../domain/local-time.rules";
import { board, changesOf, detailItems, scoreCells } from "../domain/rep-board.rules";
import {
  type CellParam,
  cellKey,
  cellProblem,
  DEFAULT_JOB_TYPES,
  DEFAULT_SETTINGS,
  defaultCell,
  isCell,
  jobTypesProblem,
  REP_CELLS,
  REP_ROLES,
  type RepGroup,
  type RepRole,
  settingsProblem,
} from "../domain/rep-config.rules";
import {
  normaliseCell,
  normaliseJobTypes,
  type Resolved,
  resolveConfig,
} from "../domain/rep-normalise.rules";
import { decaySample, roleScore } from "../domain/rep-score.rules";

export class RepFail extends Error {
  constructor(
    readonly kind: "not_found" | "invalid" | "forbidden",
    readonly detail = "",
  ) {
    super(kind);
  }
}

export type RepDeps = {
  uow: PackUow<{ rep: RepRepo }>;
  timeZoneOf: (tenantId: string) => Promise<string>;
  now: () => Date;
  /** Ghép hai phần đọc song song ⇒ đầu vào chấm (adapter `rowsOf`). */
  merge: (a: AggPart, f: FactPart) => ScoreRows;
};

export const cellsOf = (cfg: Resolved, roles: readonly RepRole[] = REP_ROLES): CellParam[] =>
  REP_CELLS.filter(([, r]) => roles.includes(r)).map(([grp, role]) => ({
    grp,
    role,
    cfg: cfg.cells[cellKey(grp, role)],
  }));

/** Tháng đầu kỳ lịch sử: `months` kỳ đã chốt gần nhất (YYYY-MM-01). */
export function historyFrom(today: string, months: number): string {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 - months, 1));
  return d.toISOString().slice(0, 10);
}

type Over = NonNullable<Parameters<typeof resolveConfig>[1]>;
const check = (msg: string | null) => {
  if (msg) throw new RepFail("invalid", msg);
};
/** Bản nháp "thử tính" ⇒ phần đè lên cấu hình hiện tại (sai ⇒ 422, ô lạ ⇒ 404). */
function draftOf(b: RepPreviewIn): Over {
  const over: Over = {};
  if (b.cell) {
    if (!isCell(b.cell.group, b.cell.role)) throw new RepFail("not_found");
    const cell = normaliseCell(b.cell.config);
    check(cellProblem(cell));
    over.cell = [cellKey(b.cell.group, b.cell.role), cell];
  }
  if (b.settings) {
    check(settingsProblem(b.settings));
    over.settings = b.settings;
  }
  if (b.job_types) {
    over.jobTypes = normaliseJobTypes(b.job_types);
    check(jobTypesProblem(over.jobTypes));
  }
  return over;
}

export function reputationUsecase(d: RepDeps) {
  const today = async (who: PackWho) => localDate(d.now(), await d.timeZoneOf(who.tenantId));
  const config = async (who: PackWho, over?: Parameters<typeof resolveConfig>[1]) =>
    resolveConfig(await d.uow.tenant(who, (r) => r.rep.configs()), over);

  /**
   * Cấu hình (một câu nhỏ — khoảng tính/bậc thang của ô cần cho SQL) rồi hai câu chấm ĐỘC LẬP song song ở hai tx chỉ đọc (Luật 4c:
   * độ trễ = câu chậm nhất; số câu cố định). Một đối tác khi `party`.
   */
  const rowsAt = (who: PackWho, day: string, cells: CellParam[], party: string | null) =>
    Promise.all([
      d.uow.tenant(who, (r) => r.rep.aggRows(day, cells, party)),
      d.uow.tenant(who, (r) => r.rep.factRows(day, cells, party)),
    ]).then(([a, f]) => d.merge(a, f));
  async function scored(who: PackWho, roles: readonly RepRole[], party: string | null) {
    const [day, cfg] = await Promise.all([today(who), config(who)]);
    return { day, cfg, rows: await rowsAt(who, day, cellsOf(cfg, roles), party) };
  }

  const list = async (who: PackWho, role: RepRole | "all") => {
    const roles = role === "all" ? REP_ROLES : [role];
    const s = await scored(who, roles, null);
    return board(s.rows, s.cfg, roles);
  };

  /** DT-02: điểm từng nhóm + tiêu chí + từng việc góp điểm. */
  const one = async (who: PackWho, party: string, role: RepRole) => {
    const s = await scored(who, [role], party);
    const cells = scoreCells(s.rows, s.cfg).get(`${party}\u0001${role}`);
    if (!cells) throw new RepFail("not_found");
    const det = await d.uow.tenant(who, (r) =>
      r.rep.detailRows(s.day, cellsOf(s.cfg, [role]), party),
    );
    return {
      party,
      name: s.rows.names.get(party) ?? party.replace(/^(tax|name):/, ""),
      role,
      ...roleScore(cells, s.cfg.settings),
      groups: cells,
      items: detailItems(role, det, s.cfg, s.day),
    };
  };

  /** DT-03: điểm đã chốt các tháng + điểm hiện tại (tính khi đọc). */
  const history = async (who: PackWho, party: string, role: RepRole, months: number) => {
    const day = await today(who);
    const [locked, cur] = await Promise.all([
      d.uow.tenant(who, (r) => r.rep.lockHistory(party, role, historyFrom(day, months))),
      scored(who, [role], party),
    ]);
    const cells = cur.rows.inputs.size
      ? scoreCells(cur.rows, cur.cfg).get(`${party}\u0001${role}`)
      : undefined;
    if (!cells && !locked.length) throw new RepFail("not_found");
    const now = cells ? roleScore(cells, cur.cfg.settings) : null;
    return {
      party,
      role,
      months,
      thresholds: { good_from: cur.cfg.settings.good_from, fair_from: cur.cfg.settings.fair_from },
      points: locked.filter((p) => p.grp === "all").map(({ grp: _g, ...p }) => p),
      groups: locked.filter((p) => p.grp !== "all"),
      current: now && { period: day.slice(0, 7), ...now },
    };
  };

  const getConfig = async (who: PackWho) => {
    const cfg = await config(who);
    return {
      cells: cfg.cells,
      settings: cfg.settings,
      job_types: cfg.jobTypes,
      versions: cfg.versions,
      /** Mặc định BA (V2-L: chấm cam + Khôi phục). */
      defaults: {
        cells: Object.fromEntries(REP_CELLS.map(([g, r]) => [cellKey(g, r), defaultCell(g, r)])),
        settings: DEFAULT_SETTINGS,
        job_types: DEFAULT_JOB_TYPES,
      },
    };
  };

  const save = (who: PackWho, scope: string, value: unknown) =>
    d.uow.tenant(who, (r) => r.rep.saveConfig(scope, value));

  const saveCell = async (who: PackWho, g: RepGroup, r: RepRole, b: RepCellConfigIn) => {
    if (!isCell(g, r)) throw new RepFail("not_found");
    const cell = normaliseCell(b);
    check(cellProblem(cell));
    return save(who, cellKey(g, r), cell);
  };
  const saveSettings = async (who: PackWho, b: RepSettingsIn) => {
    check(settingsProblem(b));
    return save(who, "settings", b);
  };
  const saveJobTypes = async (who: PackWho, b: RepJobTypesIn) => {
    const items = normaliseJobTypes(b.items);
    check(jobTypesProblem(items));
    return save(who, "job_types", items);
  };

  /** "Thử tính": điểm hiện tại vs theo bản nháp (chỉ đối tác đổi điểm/mức) + mẫu 3 việc theo độ cũ. Không ghi. */
  const preview = async (who: PackWho, b: RepPreviewIn) => {
    const over = draftOf(b);
    const s = await scored(who, REP_ROLES, null);
    const next: Resolved = {
      cells: over.cell ? { ...s.cfg.cells, [over.cell[0]]: over.cell[1] } : s.cfg.cells,
      settings: over.settings ?? s.cfg.settings,
      jobTypes: over.jobTypes ?? s.cfg.jobTypes,
      versions: s.cfg.versions,
    };
    // Khoảng tính / bậc thang của bản nháp đổi tập việc ⇒ gom lại theo bản nháp (một câu) khi ô đổi.
    const rows = over.cell ? await rowsAt(who, s.day, cellsOf(next), null) : s.rows;
    const after = board(rows, next, REP_ROLES);
    const decay = over.cell ? over.cell[1].decay : null;
    return {
      total: after.length,
      changes: changesOf(board(s.rows, s.cfg, REP_ROLES), after),
      sample: decay ? decaySample(decay) : null,
    };
  };

  return {
    list,
    one,
    history,
    getConfig,
    saveCell,
    saveSettings,
    saveJobTypes,
    preview,
    config,
    today,
    scored,
  };
}
export type ReputationUsecase = ReturnType<typeof reputationUsecase>;
