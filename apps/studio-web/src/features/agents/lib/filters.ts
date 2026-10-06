// HUB-FR-60 · H4a-R11 · bộ lọc danh sách agent trên URL (`?q=&runtime=&status=`): khớp phía client + tham số phía server.
import { AGENT_RUNTIMES, type AgentListItem, type AgentRuntime } from "@ai/contracts/studio";
import type { AgentListParams } from "../api";

export type AgentFilters = { q: string; runtime?: AgentRuntime; status?: "on" | "off" };
export type AgentSearch = { q?: string; runtime?: AgentRuntime; status?: "on" | "off" };

/** `validateSearch` của route: bỏ giá trị lạ thay vì ném lỗi. */
export function parseSearch(raw: Record<string, unknown>): AgentSearch {
  const q = typeof raw.q === "string" && raw.q.trim() !== "" ? raw.q : undefined;
  const runtime = AGENT_RUNTIMES.find((r) => r === raw.runtime);
  const status = raw.status === "on" || raw.status === "off" ? raw.status : undefined;
  return { q, runtime, status };
}

export const toFilters = (s: AgentSearch): AgentFilters => ({
  q: s.q ?? "",
  runtime: s.runtime,
  status: s.status,
});

export const hasFilters = (f: AgentFilters): boolean =>
  f.q.trim() !== "" || f.runtime !== undefined || f.status !== undefined;

/** Tìm theo key + tên VI/EN, không phân biệt hoa thường (plan-frontend §3). */
export function matchesFilters(a: AgentListItem, f: AgentFilters): boolean {
  if (f.runtime && a.runtime !== f.runtime) return false;
  if (f.status === "on" && !a.enabled) return false;
  if (f.status === "off" && a.enabled) return false;
  const q = f.q.trim().toLowerCase();
  if (!q) return true;
  return [a.key, a.name.vi, a.name.en].some((s) => s.toLowerCase().includes(q));
}

/** Tham số gửi máy chủ khi danh sách bị cắt (`truncated`). */
export function toServerParams(f: AgentFilters): AgentListParams {
  const q = f.q.trim();
  return {
    q: q === "" ? undefined : q,
    runtime: f.runtime,
    enabled: f.status === "on" ? "true" : f.status === "off" ? "false" : undefined,
  };
}
