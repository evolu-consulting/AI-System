// CHAT-AC-58 · P-a PF4: hàm thuần cho màn Token (gộp cột Cache, nhãn vai/chế độ).
import type { TokenTotals, UsageCall } from "@ai/contracts/chat";

/** Cột Cache = đọc + ghi cache. */
export const cacheOf = (t: TokenTotals): number => t.cache_read + t.cache_write;

export const roleKey = (r: UsageCall["role"]): string => {
  const known = r === "plan" || r === "member";
  return `process.usage.role.${known ? r : "agent"}`;
};

export const modelLabel = (m: string | null): string => m ?? "—";
