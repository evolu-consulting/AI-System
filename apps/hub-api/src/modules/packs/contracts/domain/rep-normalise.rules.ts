// V2-E · CD-02..05: bản nháp người dùng gửi ⇒ cấu hình chuẩn (tiêu chí có sẵn giữ tên + kiểu của BA, chỉ đổi bật/tắt + trọng số;
// tiêu chí tự thêm lấy khoá từ tên), và hàng đã lưu ⇒ cấu hình hiệu lực (vắng ⇒ mặc định BA). Thuần.
import {
  BUILTIN,
  type CellConfig,
  type CellKey,
  type Criterion,
  type CriterionKind,
  cellKey,
  customKey,
  DEFAULT_JOB_TYPES,
  DEFAULT_SETTINGS,
  defaultCell,
  type JobType,
  REP_CELLS,
  type ScoredMilestone,
  type Settings,
} from "./rep-config.rules";

export type CriterionIn = {
  key?: string | null | undefined;
  label: string;
  kind: CriterionKind;
  milestone?: ScoredMilestone | null | undefined;
  penalty?: number | null | undefined;
  weight: number;
  enabled: boolean;
};
export type CellIn = Omit<CellConfig, "criteria"> & { criteria: CriterionIn[] };

export function normaliseCriterion(c: CriterionIn): Criterion {
  const b = c.key ? BUILTIN[c.key] : undefined;
  if (b) return { ...b, weight: c.weight, enabled: c.enabled, custom: false };
  const key = c.key && /^custom:[a-z0-9-]{1,40}$/.test(c.key) ? c.key : customKey(c.label);
  return {
    key,
    label: c.label.trim(),
    kind: c.kind,
    ...(c.kind === "ontime" && c.milestone ? { milestone: c.milestone } : {}),
    ...(c.kind === "bad_count" ? { penalty: c.penalty ?? 10 } : {}),
    weight: c.weight,
    enabled: c.enabled,
    custom: true,
  };
}

export const normaliseCell = (c: CellIn): CellConfig => ({
  criteria: c.criteria.map(normaliseCriterion),
  window_months: c.window_months,
  decay: { months: [...c.decay.months], factors: [...c.decay.factors] },
  late_per_day: c.late_per_day,
});

export const normaliseJobTypes = (items: Omit<JobType, "ord">[]): JobType[] =>
  items.map((x, i) => ({ ...x, name: x.name.trim(), ord: i }));

export type Resolved = {
  cells: Record<CellKey, CellConfig>;
  settings: Settings;
  jobTypes: JobType[];
  /** Phạm vi ⇒ version đã lưu (vắng = 0, đang dùng mặc định). */
  versions: Record<string, number>;
};

/** Hàng đã lưu ⇒ cấu hình hiệu lực; `over` = bản nháp đè (thử tính). */
export function resolveConfig(
  stored: readonly { scope: string; version: number; config: unknown }[],
  over: { cell?: [CellKey, CellConfig]; settings?: Settings; jobTypes?: JobType[] } = {},
): Resolved {
  const by = new Map(stored.map((s) => [s.scope, s]));
  const versions: Record<string, number> = {};
  const cells = {} as Record<CellKey, CellConfig>;
  for (const [g, r] of REP_CELLS) {
    const k = cellKey(g, r);
    const s = by.get(k);
    versions[k] = s?.version ?? 0;
    cells[k] = (s?.config as CellConfig | undefined) ?? defaultCell(g, r);
  }
  if (over.cell) cells[over.cell[0]] = over.cell[1];
  versions.settings = by.get("settings")?.version ?? 0;
  versions.job_types = by.get("job_types")?.version ?? 0;
  return {
    cells,
    settings: over.settings ?? {
      ...DEFAULT_SETTINGS,
      ...((by.get("settings")?.config as object) ?? {}),
    },
    jobTypes:
      over.jobTypes ?? (by.get("job_types")?.config as JobType[] | undefined) ?? DEFAULT_JOB_TYPES,
    versions,
  };
}
