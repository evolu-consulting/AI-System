// V2-E · DT-01/02 · §5.1a · §5.1j: số đã gom ⇒ bảng điểm (một dòng mỗi đối tác × vai, kèm điểm từng nhóm), chi tiết từng việc góp
// điểm của một tiêu chí, hàng điểm chốt tháng. Thuần.
import {
  type CellKey,
  cellKey,
  type JobType,
  type RepGroup,
  type RepRole,
} from "./rep-config.rules";
import type { Resolved } from "./rep-normalise.rules";
import {
  type CellInput,
  type CellScore,
  cellScore,
  decayAt,
  type Level,
  milestoneScore,
  roleScore,
} from "./rep-score.rules";

export type GroupOut = Omit<CellScore, "role" | "criteria">;
export type PartnerRow = {
  party: string;
  name: string;
  role: RepRole;
  score: number | null;
  level: Level;
  jobs: number;
  groups: GroupOut[];
};
export type Rows = { inputs: Map<string, CellInput>; names: Map<string, string> };

const ctx = (cfg: Resolved, k: CellKey) => ({
  cell: cfg.cells[k],
  settings: cfg.settings,
  jobTypes: cfg.jobTypes,
});

type PartyCells = { party: string; role: RepRole; cells: CellScore[] };
/** Điểm mọi ô, gom theo (đối tác, vai). */
function partyCells(rows: Rows, cfg: Resolved): Map<string, PartyCells> {
  const out = new Map<string, PartyCells>();
  for (const inp of rows.inputs.values()) {
    const k = cellKey(inp.grp, inp.role);
    if (!cfg.cells[k]) continue;
    const pr = `${inp.party}\u0001${inp.role}`;
    let a = out.get(pr);
    if (!a) {
      a = { party: inp.party, role: inp.role, cells: [] };
      out.set(pr, a);
    }
    a.cells.push(cellScore(inp, ctx(cfg, k)));
  }
  return out;
}
/** Điểm mọi ô, khoá `đối tác \u0001 vai`. */
export function scoreCells(rows: Rows, cfg: Resolved): Map<string, CellScore[]> {
  return new Map([...partyCells(rows, cfg)].map(([k, v]) => [k, v.cells]));
}

const GROUP_ORDER: Record<RepGroup, number> = { service: 0, goods: 1, referral: 2 };
const groupOut = (c: CellScore): GroupOut => ({
  group: c.group,
  score: c.score,
  data_score: c.data_score,
  stars: c.stars,
  level: c.level,
  jobs: c.jobs,
  value: c.value,
});
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * DT-01: bảng điểm — vai lọc theo `roles`; sắp theo tên rồi vai (so mã ký tự: ổn định, rẻ — Luật 4c: Collator tiếng Việt trên 3.000
 * dòng tốn ~7 ms; giao diện tự sắp theo cột người dùng chọn).
 */
export function board(rows: Rows, cfg: Resolved, roles: readonly RepRole[]): PartnerRow[] {
  const out: PartnerRow[] = [];
  for (const { party, role, cells } of partyCells(rows, cfg).values()) {
    if (!roles.includes(role)) continue;
    if (cells.length > 1) cells.sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group]);
    const rs = roleScore(cells, cfg.settings);
    out.push({
      party,
      name: rows.names.get(party) ?? party.replace(/^(tax|name):/, ""),
      role,
      score: rs.score,
      level: rs.level,
      jobs: rs.jobs,
      groups: cells.map(groupOut),
    });
  }
  return out.sort((a, b) => cmp(a.name, b.name) || cmp(a.role, b.role));
}

/** "Thử tính": đối tác × vai có điểm hoặc mức đổi giữa hai bảng. */
export function changesOf(before: readonly PartnerRow[], after: readonly PartnerRow[]) {
  const old = new Map(before.map((p) => [`${p.party}\u0001${p.role}`, p]));
  return after.flatMap((p) => {
    const o = old.get(`${p.party}\u0001${p.role}`);
    if (o && o.score === p.score && o.level === p.level) return [];
    return [
      {
        party: p.party,
        name: p.name,
        role: p.role,
        old: o?.score ?? null,
        new: p.score,
        old_level: o?.level ?? "new",
        new_level: p.level,
      },
    ];
  });
}

export type DetailItem = {
  source: "milestone" | "job";
  id: string;
  group: RepGroup;
  criterion: string;
  at: string;
  /** Điểm việc (việc xấu của tiêu chí đếm: null). */
  score: number | null;
  h: number;
  label: string;
  late_days?: number;
  fault?: string | null;
  contract_id: string | null;
  contract?: string | null;
  note?: string | null;
};
type Ms = {
  id: string;
  grp: RepGroup;
  kind: string;
  title: string | null;
  contract_id: string;
  contract: string | null;
  due_date: string;
  done_at: string;
  fault: string | null;
};
type Jb = {
  id: string;
  grp: RepGroup;
  job_type: string;
  at: string;
  note: string | null;
  contract_id: string | null;
};

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** DT-02: mỗi việc ⇒ tiêu chí nó góp vào (theo ô), hệ số độ cũ, điểm việc. Việc không thuộc tiêu chí bật nào bị bỏ. */
export function detailItems(
  role: RepRole,
  r: { ms: Ms[]; jb: Jb[] },
  cfg: Resolved,
  today: string,
): DetailItem[] {
  const out: DetailItem[] = [];
  for (const m of r.ms) {
    const cell = cfg.cells[cellKey(m.grp, role)];
    const c = cell?.criteria.find(
      (x) => x.enabled && x.kind === "ontime" && x.milestone === m.kind,
    );
    if (!cell || !c) continue;
    const late = Math.max(0, daysBetween(m.due_date, m.done_at));
    out.push({
      source: "milestone",
      id: m.id,
      group: m.grp,
      criterion: c.key,
      at: m.done_at,
      score: milestoneScore(late, m.fault, cell.late_per_day),
      h: decayAt(m.done_at, today, cell.decay),
      label: m.title ?? m.kind,
      late_days: late,
      fault: m.fault,
      contract_id: m.contract_id,
      contract: m.contract,
    });
  }
  const types = new Map<string, JobType>(cfg.jobTypes.map((j) => [j.key, j]));
  for (const j of r.jb) {
    const cell = cfg.cells[cellKey(j.grp, role)];
    const t = types.get(j.job_type);
    const c = t && cell?.criteria.find((x) => x.enabled && x.key === t.criterion);
    if (!cell || !t || !c) continue;
    out.push({
      source: "job",
      id: j.id,
      group: j.grp,
      criterion: c.key,
      at: j.at,
      score: c.kind === "bad_count" ? null : t.score,
      h: decayAt(j.at, today, cell.decay),
      label: t.name,
      contract_id: j.contract_id,
      note: j.note,
    });
  }
  return out;
}

export type LockOut = {
  party: string;
  role: RepRole;
  grp: RepGroup | "all";
  score: number | null;
  data_score: number | null;
  level: Level;
  jobs: number;
  detail: Record<string, unknown>;
};

/** §5.1j: hàng chốt của một kỳ — mỗi ô + một hàng điểm vai (`all`). */
export function lockRows(rows: Rows, cfg: Resolved): LockOut[] {
  const out: LockOut[] = [];
  for (const { party, role, cells } of partyCells(rows, cfg).values()) {
    for (const c of cells)
      out.push({
        party,
        role,
        grp: c.group,
        score: c.score,
        data_score: c.data_score,
        level: c.level,
        jobs: c.jobs,
        detail: {
          stars: c.stars,
          criteria: Object.fromEntries(c.criteria.map((x) => [x.key, x.score])),
        },
      });
    const rs = roleScore(cells, cfg.settings);
    out.push({
      party,
      role,
      grp: "all",
      score: rs.score,
      data_score: null,
      level: rs.level,
      jobs: rs.jobs,
      detail: {},
    });
  }
  return out;
}
