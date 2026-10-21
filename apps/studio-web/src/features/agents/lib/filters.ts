// HUB-FR-60 · H4a-R11 · bộ lọc danh sách agent trên URL (`?q=&runtime=&status=`): khớp phía client + tham số phía server.
import { AGENT_RUNTIMES, type AgentListItem, type AgentRuntime } from "@ai/contracts/studio";
import type { AgentListParams } from "../api";
import { isRetired } from "./status";

export type Surface = "chat" | "background";
export type AgentFilters = {
  q: string;
  runtime?: AgentRuntime;
  status?: "on" | "off";
  surface?: Surface;
};
export type AgentSearch = {
  q?: string;
  runtime?: AgentRuntime;
  status?: "on" | "off";
  surface?: Surface;
};

/** `validateSearch` của route: bỏ giá trị lạ thay vì ném lỗi. */
export function parseSearch(raw: Record<string, unknown>): AgentSearch {
  const q = typeof raw.q === "string" && raw.q.trim() !== "" ? raw.q : undefined;
  const runtime = AGENT_RUNTIMES.find((r) => r === raw.runtime);
  const status = raw.status === "on" || raw.status === "off" ? raw.status : undefined;
  const surface = raw.surface === "chat" || raw.surface === "background" ? raw.surface : undefined;
  return { q, runtime, status, surface };
}

export const toFilters = (s: AgentSearch): AgentFilters => ({
  q: s.q ?? "",
  runtime: s.runtime,
  status: s.status,
  surface: s.surface,
});

export const hasFilters = (f: AgentFilters): boolean =>
  f.q.trim() !== "" || f.runtime !== undefined || f.status !== undefined || f.surface !== undefined;

/** Agent đã gộp (`alias_of`) chỉ hiện khi bật lọc "Đã nghỉ/Đang tắt" (status = off). */
export const visibleByDefault = (a: AgentListItem, f: AgentFilters): boolean =>
  !isRetired(a) || f.status === "off";

/** Tìm theo key + tên VI/EN, không phân biệt hoa thường (plan-frontend §3). */
export function matchesFilters(a: AgentListItem, f: AgentFilters): boolean {
  if (!visibleByDefault(a, f)) return false;
  if (f.surface && (a.surface ?? "chat") !== f.surface) return false;
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
