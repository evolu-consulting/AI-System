// REP-v3-ui · V2-E (BA v2.0 §5.1) · hình dữ liệu cấu hình điểm uy tín khi `engine = v2e`: 5 ô (nhóm SP × vai) + "Mức & đánh giá" + Loại việc.
// Kiểu theo `GET /pack/contracts/reputation/config`; thân PUT strict nên có hàm chuyển riêng ở `rep-data.ts`. Lưu riêng ở `RepPane`
// (không nằm trong bản nháp chung của hộp thoại Cài đặt).
import type { RepEngine, RepJobTypesIn, RepSettingsIn } from "@ai/contracts";

export const CELL_KEYS = [
  "service:supplier",
  "service:customer",
  "goods:supplier",
  "goods:customer",
  "referral:commission_payer",
] as const;
export type CellKey = (typeof CELL_KEYS)[number];
export const MAX_CUSTOM = 8;

export type CriterionKind = "ontime" | "jobs" | "bad_count" | "manual";
export type Milestone = "delivery" | "payment" | "serial" | "commission";
export type Criterion = {
  key: string;
  label: string;
  kind: CriterionKind;
  milestone?: Milestone | undefined;
  penalty?: number | undefined;
  weight: number;
  enabled: boolean;
  custom: boolean;
};
export type Cell = {
  criteria: Criterion[];
  window_months: number;
  decay: { months: number[]; factors: number[] };
  late_per_day: number;
};
export type JobType = RepJobTypesIn["items"][number];

/** Một lần đọc `GET /reputation/config` (cả mặc định BA, cờ `engine`). */
export type RepConfigFull = {
  engine: RepEngine;
  cells: Record<CellKey, Cell>;
  settings: RepSettingsIn;
  job_types: (JobType & { ord?: number })[];
  versions: Record<string, number>;
  defaults: {
    cells: Record<CellKey, Cell>;
    settings: RepSettingsIn;
    job_types: (JobType & { ord?: number })[];
  };
};

/** Mọi thứ cài đặt uy tín V2-E chỉnh được. */
export type RepData = {
  cells: Record<CellKey, Cell>;
  repSettings: RepSettingsIn;
  jobTypes: JobType[];
};
export type RepState = { saved: RepData; defaults: RepData };

/** Mục đang chọn ở thanh ô + tab của ô. */
export type RepSel = CellKey | "common";
export type CellTab = "crit" | "time" | "types";
