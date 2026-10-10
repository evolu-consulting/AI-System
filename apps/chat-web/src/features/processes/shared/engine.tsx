// FD2 · cờ engine dò lúc chạy (không cờ build): `on` ⇒ hiện mọi lối vào quy trình, ngược lại ẩn và không nạp chuỗi `process.*`.
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ensureProcessLocale } from "~/app/i18n";
import { probeEngine } from "./api";
import { processKeys } from "./keys";
import type { EngineState } from "./types";

const STALE_MS = 5 * 60_000;
const RETRY_MS = 30_000;

/**
 * `on` chỉ khi Hub báo bật VÀ chuỗi `process.*` của ngôn ngữ hiện tại đã nạp (tránh nháy khoá).
 * Lỗi mạng/5xx ⇒ `unknown` (ẩn), thử lại đúng 1 lần sau 30 s; Hub bật giữa phiên cần tải lại trang. Phiên hết ⇒ `queryClient.clear()`.
 */
export function useProcessEngine(): EngineState {
  const { i18n } = useTranslation();
  const lng = i18n.language;
  const probe = useQuery({
    queryKey: processKeys.engine,
    queryFn: ({ signal }) => probeEngine(signal),
    staleTime: STALE_MS,
    retry: 1,
    retryDelay: RETRY_MS,
  });
  const on = probe.data === "on";
  const locale = useQuery({
    queryKey: processKeys.locale(lng),
    queryFn: async () => {
      await ensureProcessLocale(lng);
      return true;
    },
    enabled: on,
    staleTime: Number.POSITIVE_INFINITY,
    placeholderData: (prev) => prev,
  });
  if (probe.data === "off") return "off";
  return on && locale.data === true ? "on" : "unknown";
}

export const useProcessEngineOn = (): boolean => useProcessEngine() === "on";

/** Mọi lối vào quy trình bọc trong cổng này: không `on` ⇒ `fallback` (mặc định không vẽ gì). */
export function ProcessEngineGate({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return useProcessEngineOn() ? <>{children}</> : <>{fallback}</>;
}

/** Route quy trình: `on` vẽ trang; `off` (hoặc dò lỗi) ⇒ `NotFoundState`; còn đang dò ⇒ `pending` (khung chờ). */
export function useEngineRoute(): "pending" | "on" | "off" {
  const state = useProcessEngine();
  const probe = useQuery<EngineState>({ queryKey: processKeys.engine, enabled: false });
  if (state === "on") return "on";
  if (state === "off" || probe.isError) return "off";
  return "pending";
}
