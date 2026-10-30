// ADM-FR-65 · CR-056 · P-a FD2: cờ engine dò lúc chạy — `on` mới hiện nav "Quy trình" và nạp chuỗi `process.*` (phần `common` + `admin`).
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ensureProcessLocale } from "@/app/i18n";
import { useSession } from "@/lib/auth/use-session";
import { type EngineProbe, type EngineState, probeEngineInfo } from "./api";

export const PROCESS_ENGINE_KEY = ["process", "engine"] as const;
const STALE_MS = 5 * 60_000;
const RETRY_MS = 30_000;

/** Tuỳ chọn DUY NHẤT của lời dò, mọi observer cùng key phải dùng (kể cả observer chỉ đọc `enabled: false`): TanStack lấy tuỳ chọn
 *  của observer gắn sau cùng cho lần fetch kế ⇒ observer thiếu `queryFn` làm retry/focus lỗi "No queryFn" ⇒ ẩn nav "Quy trình". */
export const engineProbeOptions = (enabled: boolean) => ({
  queryKey: PROCESS_ENGINE_KEY,
  queryFn: probeEngineInfo,
  enabled,
  staleTime: STALE_MS,
  retry: 1,
  retryDelay: RETRY_MS,
});

/** `on` chỉ khi Hub báo bật VÀ chuỗi `process.*` của ngôn ngữ hiện tại đã nạp. Lỗi mạng/5xx ⇒ `unknown` (ẩn), thử lại 1 lần sau 30 s. */
export function useProcessEngine(): EngineState {
  const { i18n } = useTranslation();
  const lng = i18n.language;
  // `member` không vào khung quản trị ⇒ không dò.
  const role = useSession((s) => s.me?.role);
  const allowed = role === "platform_admin" || role === "tenant_admin";
  const probe = useQuery(engineProbeOptions(allowed));
  const on = probe.data?.state === "on";
  const locale = useQuery({
    queryKey: ["process", "locale", lng],
    queryFn: async () => {
      await ensureProcessLocale(lng);
      return true;
    },
    enabled: on,
    staleTime: Number.POSITIVE_INFINITY,
    placeholderData: (prev) => prev,
  });
  if (probe.data?.state === "off") return "off";
  return on && locale.data === true ? "on" : "unknown";
}

export const useProcessEngineOn = (): boolean => useProcessEngine() === "on";

/** Route quy trình: `on` vẽ trang; `off` (hoặc dò lỗi) ⇒ NotFound; còn đang dò ⇒ `pending`. */
export function useEngineRoute(): "pending" | "on" | "off" {
  const state = useProcessEngine();
  const probe = useQuery<EngineProbe>(engineProbeOptions(false));
  if (state === "on") return "on";
  if (state === "off" || probe.isError) return "off";
  return "pending";
}

/** fnr-fix-unfreeze · Hub ở chế độ route chỉ quản trị (`HUB_PROCESS_ROUTES=admin`): đọc từ cùng lời dò (cache), không gọi thêm. */
export function useProcessAdminOnly(): boolean {
  const probe = useQuery<EngineProbe>(engineProbeOptions(false));
  return probe.data?.adminOnly === true;
}
