// V2-N · Tổng quan: `GET /overview?period=` (4 con số + 12 cột/nhóm), `GET /my-work/todo` (Cần xử lý 8 nguồn), `POST /my-work/todo/dismiss`.
import type { OverviewOut, OverviewPeriod, TodoAction, TodoOut } from "@ai/contracts";
import { api } from "@ai/web-kit/http";

const BASE = "/pack/contracts";
export const overviewKeys = {
  figures: (p: OverviewPeriod) => ["overview", "figures", p] as const,
  todo: ["overview", "todo"] as const,
};

export const fetchOverview = (period: OverviewPeriod, signal?: AbortSignal) =>
  api<OverviewOut>(`${BASE}/overview?period=${period}`, { signal });
export const fetchTodo = (signal?: AbortSignal) => api<TodoOut>(`${BASE}/my-work/todo`, { signal });
export const dismissTodo = (key: string, action: TodoAction) =>
  api<{ ok: true }>(`${BASE}/my-work/todo/dismiss`, { method: "POST", body: { key, action } });
