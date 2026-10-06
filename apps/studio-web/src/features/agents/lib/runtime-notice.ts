// HUB-FR-61 · H4a-R04, R05 · quy tắc cảnh báo/lọc cho bước ② ③ của editor (hàm thuần).
import type { WorkflowItem } from "../hooks/use-editor-catalogs";

/** codex/gemini chưa chạy được tới khi có H2d (QB/Q8) — vẫn lưu được. */
export const cliNotReady = (cli: string): boolean => cli !== "claude";

const WORKER_RUNTIMES = ["llm", "agentic-cli", "python"];

/** Runtime cần Worker nhưng catalog agent-types (đã tải xong) không có loại nào `available` cho runtime đó. */
export function runtimeMissing(
  runtime: string,
  types: { runtime: string; available: boolean }[],
  loaded: boolean,
): boolean {
  if (!loaded || !WORKER_RUNTIMES.includes(runtime)) return false;
  return !types.some((x) => x.runtime === runtime && x.available);
}

/** Lọc catalog cho picker: theo loại app (`""` = tất cả) và chuỗi tìm trên key/tên. */
export function filterWorkflows(items: WorkflowItem[], q: string, appType: string): WorkflowItem[] {
  const needle = q.trim().toLowerCase();
  return items.filter(
    (w) =>
      (appType === "" || w.app_type === appType) &&
      `${w.key} ${w.name}`.toLowerCase().includes(needle),
  );
}

export const appTypesOf = (items: WorkflowItem[]): string[] =>
  [...new Set(items.map((w) => w.app_type))].sort();
