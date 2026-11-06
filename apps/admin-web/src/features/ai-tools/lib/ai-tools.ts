// CR-121 R6 · c16 · lõi thuần của trang Công cụ AI: lọc (chip trạng thái + loại + ô tìm), đếm chip, "Dùng bởi", cắt "Xem thêm".
import type { AiToolUsage } from "@ai/contracts/workflow-tools";

/** Loại thứ gọi tới công cụ. Hook / quy trình chưa có nguồn đọc ở admin ⇒ chưa có chip. */
export type UsageKind = "agent" | "command";
export const USAGE_KINDS: readonly UsageKind[] = ["agent", "command"];
export type StatusFilter = "on" | "unused";

export type AiToolFilters = { status?: StatusFilter; kind?: UsageKind; q?: string };

/** Số dòng hiện lần đầu và mỗi lần bấm "Xem thêm". */
export const FIRST_PAGE = 6;
export const MORE_STEP = 20;

export const usedTotal = (t: AiToolUsage): number => t.agent_count + t.command_count;
/** "Chưa dùng" = không agent nào, không lệnh nào gọi tới. */
export const isUnused = (t: AiToolUsage): boolean => usedTotal(t) === 0;

/** `?kind=` hợp lệ của chip loại; `workflow` (địa chỉ cũ) = không lọc. */
export function parseUsageKind(v: unknown): UsageKind | undefined {
  return USAGE_KINDS.find((k) => k === v);
}
export function parseStatus(v: unknown): StatusFilter | undefined {
  return v === "on" || v === "unused" ? v : undefined;
}

/** "Dùng bởi" của một công cụ: chỉ loại có số > 0, theo thứ tự cố định agent → lệnh. */
export function usageParts(t: AiToolUsage): { kind: UsageKind; count: number }[] {
  const parts: { kind: UsageKind; count: number }[] = [
    { kind: "agent", count: t.agent_count },
    { kind: "command", count: t.command_count },
  ];
  return parts.filter((p) => p.count > 0);
}

const usedBy = (t: AiToolUsage, k: UsageKind): boolean =>
  k === "agent" ? t.agent_count > 0 : t.command_count > 0;

/** Khớp tên hoặc mô tả, không phân biệt hoa thường; khoá kỹ thuật không phải thứ người dùng tìm. */
const matchesQuery = (t: AiToolUsage, q: string): boolean => {
  const s = q.trim().toLowerCase();
  return s === "" || t.name.toLowerCase().includes(s) || t.description.toLowerCase().includes(s);
};

export function filterTools(items: readonly AiToolUsage[], f: AiToolFilters): AiToolUsage[] {
  return items.filter(
    (t) =>
      matchesQuery(t, f.q ?? "") &&
      (f.kind === undefined || usedBy(t, f.kind)) &&
      (f.status === undefined || (f.status === "on" ? t.enabled : isUnused(t))),
  );
}

export type ToolCounts = {
  all: number;
  on: number;
  unused: number;
  agent: number;
  command: number;
};

/** Số đếm trên chip — tính trên TOÀN danh mục (không phụ thuộc bộ lọc đang chọn), một lượt duyệt. */
export function toolCounts(items: readonly AiToolUsage[]): ToolCounts {
  const c: ToolCounts = { all: items.length, on: 0, unused: 0, agent: 0, command: 0 };
  for (const t of items) {
    if (t.enabled) c.on++;
    if (isUnused(t)) c.unused++;
    if (t.agent_count > 0) c.agent++;
    if (t.command_count > 0) c.command++;
  }
  return c;
}

/** "6 trong 26": cắt `shown` dòng đầu; `more` = còn dòng để "Xem thêm". */
export function sliceShown<T>(rows: readonly T[], shown: number): { rows: T[]; more: boolean } {
  return { rows: rows.slice(0, shown), more: rows.length > shown };
}

/** "Công ty dùng": đang bật / tổng. */
export const companyTally = (cs: readonly { on: boolean }[]): { on: number; total: number } => ({
  on: cs.filter((c) => c.on).length,
  total: cs.length,
});
