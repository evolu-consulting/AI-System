// CR-121 R6 · c16 · lõi thuần của trang Công cụ AI: lọc (chip trạng thái + loại + ô tìm), đếm chip, "Dùng bởi" (công ty), cắt "Xem thêm".
import type { AiTool } from "@ai/contracts/workflow-tools";

/** Loại công cụ. Hook: admin chưa có nguồn đọc ⇒ chưa có loại. */
export type AiToolKind = AiTool["kind"];
export const AI_TOOL_KINDS: readonly AiToolKind[] = ["agent", "command", "workflow"];
export type StatusFilter = "on" | "unused";
/** `secret` = tên secret (chip "Dùng secret X", từ nút ở Secrets); chỉ workflow có secret. */
export type AiToolFilters = {
  status?: StatusFilter;
  kind?: AiToolKind;
  q?: string;
  secret?: string;
};

/** Số dòng hiện lần đầu ("6 trong N") và mỗi lần bấm "Xem thêm". */
export const FIRST_PAGE = 6;
export const MORE_STEP = 20;

/** "Chưa dùng" = chưa công ty nào dùng. */
export const isUnused = (t: AiTool): boolean => t.companies_count === 0;

export const parseKind = (v: unknown): AiToolKind | undefined => AI_TOOL_KINDS.find((k) => k === v);
export function parseStatus(v: unknown): StatusFilter | undefined {
  return v === "on" || v === "unused" ? v : undefined;
}

/** 6 ký tự cuối id: admin chỉ biết `agent_id` (Mơ hồ A6) nên agent hiện "Agent …xxxxxx". */
export const idTail = (id: string): string => id.slice(-6);

/** Tên để tìm/hiện: lệnh có `/`, agent theo đuôi id; mã workflow chỉ để tìm (liên kết từ Secrets), không hiện. */
export const searchText = (t: AiTool): string =>
  `${t.kind === "command" ? "/" : ""}${t.name ?? idTail(t.id)} ${t.description ?? ""} ${t.key ?? ""}`.toLowerCase();

export function filterTools(items: readonly AiTool[], f: AiToolFilters): AiTool[] {
  const q = (f.q ?? "").trim().toLowerCase();
  return items.filter(
    (t) =>
      (q === "" || searchText(t).includes(q)) &&
      (f.kind === undefined || t.kind === f.kind) &&
      (f.secret === undefined || t.secret === f.secret) &&
      (f.status === undefined || (f.status === "on" ? t.enabled : isUnused(t))),
  );
}

export type ToolCounts = {
  all: number;
  on: number;
  unused: number;
  agent: number;
  command: number;
  workflow: number;
};

/** Số đếm trên chip — trên TOÀN danh mục (không đổi theo bộ lọc), một lượt duyệt. */
export function toolCounts(items: readonly AiTool[]): ToolCounts {
  const c: ToolCounts = { all: items.length, on: 0, unused: 0, agent: 0, command: 0, workflow: 0 };
  for (const t of items) {
    if (t.enabled) c.on++;
    if (isUnused(t)) c.unused++;
    c[t.kind]++;
  }
  return c;
}

/** "6 trong 26": cắt `shown` dòng đầu; `more` = còn dòng để "Xem thêm". */
export function sliceShown<T>(rows: readonly T[], shown: number): { rows: T[]; more: boolean } {
  return { rows: rows.slice(0, shown), more: rows.length > shown };
}

/** Chữ cái đầu để vẽ avatar công ty. */
export const initial = (name: string): string => name.trim().charAt(0).toUpperCase() || "?";

/** Số công ty ngoài ≤ 5 tên đã trả. */
export const moreCompanies = (t: AiTool): number =>
  Math.max(0, t.companies_count - t.companies.length);

/** "Công ty dùng" của workflow: đang bật / tổng. */
export const companyTally = (cs: readonly { on: boolean }[]): { on: number; total: number } => ({
  on: cs.filter((c) => c.on).length,
  total: cs.length,
});
