// V2-L · hình dữ liệu của hộp thoại Cài đặt: bản nháp = ba nguồn API gộp một chỗ (công ty · uy tín v2 · điểm kinh doanh).
// Kiểu theo `GET /pack/contracts/{company,reputation/config,business/config}`; thân PUT strict nên có hàm chuyển riêng ở `data.ts`.
import type { BizConfig, CompanyIn, RepJobTypesIn, RepSettingsIn } from "@ai/contracts";

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

/** Một lần đọc `GET /reputation/config` (cả mặc định BA). */
export type RepConfigOut = {
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

/** Mọi thứ hộp thoại chỉnh được. */
export type SettingsData = {
  company: CompanyIn;
  cells: Record<CellKey, Cell>;
  repSettings: RepSettingsIn;
  jobTypes: JobType[];
  biz: BizConfig;
};
export type SettingsState = { saved: SettingsData; defaults: SettingsData };

export type SectionId = "co" | "rep" | "biz" | "scout";
/** Mục đang chọn ở cột trái + ô/tab uy tín. */
export type RepSel = CellKey | "common";
export type CellTab = "crit" | "time" | "types";
