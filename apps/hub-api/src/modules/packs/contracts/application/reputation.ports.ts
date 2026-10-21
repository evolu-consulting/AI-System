// V2-E · ADR-0023: cổng repo uy tín v2 (lớp 2 — chỉ kiểu); `adapters/rep.repo.ts` + `adapters/rep.sql.ts` cài. Hai phần đọc song
// song `aggRows`/`factRows` là hình thô dạng cột của SQL ⇒ cổng generic `A`/`B`, chỉ `merge` (adapter `rowsOf`) hiểu.

import type { CellParam, RepGroup, RepRole } from "../domain/rep-config.rules";
import type { MineRaw } from "../domain/rep-mine.rules";
import type { CellInput } from "../domain/rep-score.rules";

export type StoredRep = {
  scope: string;
  version: number;
  config: unknown;
  updated_by: string | null;
  updated_at: string;
};
export type LockRow = {
  party: string;
  role: RepRole;
  grp: RepGroup | "all";
  score: number | null;
  data_score: number | null;
  level: string;
  jobs: number;
  detail: Record<string, unknown>;
};
export type LockPoint = {
  period: string;
  grp: RepGroup | "all";
  score: number | null;
  level: string;
  jobs: number;
};
export type ScoreRows = { inputs: Map<string, CellInput>; names: Map<string, string> };

export type DetailMilestone = {
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
export type DetailJob = {
  id: string;
  grp: RepGroup;
  job_type: string;
  at: string;
  note: string | null;
  contract_id: string | null;
};

export type RepJobWrite = {
  party: string;
  role: RepRole;
  grp: RepGroup;
  job_type: string;
  at: string;
  note: string | null;
  contract_id: string | null;
};
export type RepRatingWrite = {
  party: string;
  role: RepRole;
  grp: RepGroup;
  criterion: string;
  stars: number;
  reason: string | null;
};

export type RepRepo<A = unknown, B = unknown> = {
  mineRows(from: string): Promise<MineRaw[]>;
  ratings(party: string, role: RepRole): Promise<Record<string, unknown>[]>;
  lockHistory(party: string, role: RepRole, from: string): Promise<LockPoint[]>;
  lockedPeriods(from: string): Promise<string[]>;
  insertLocks(period: string, rows: LockRow[]): Promise<number>;
  insertJob(w: RepJobWrite): Promise<Record<string, unknown> | null>;
  insertRating(w: RepRatingWrite): Promise<Record<string, unknown> | null>;
  scoreRows(today: string, cells: CellParam[], party?: string | null): Promise<ScoreRows>;
  aggRows(today: string, cells: CellParam[], party?: string | null): Promise<A>;
  factRows(today: string, cells: CellParam[], party?: string | null): Promise<B>;
  detailRows(
    today: string,
    cells: CellParam[],
    party: string,
  ): Promise<{ ms: DetailMilestone[]; jb: DetailJob[] }>;
  configs(): Promise<StoredRep[]>;
  saveConfig(scope: string, config: unknown): Promise<StoredRep>;
};
