// CR-122 · p22 · đọc số bước tối đa (cài đặt nền tảng) cho trình sửa quy trình; nạp vào `lib/stages-limit` cho các phép thuần.
import { PROCESS_STAGES_DEFAULT, type ProcessLimits } from "@ai/contracts/hub-admin";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/http";
import { hubConfigured, hubUrl } from "@/lib/hub";
import { setStagesMax } from "../lib/stages-limit";

export const PROCESS_LIMITS_KEY = ["hub", "process-limits"] as const;

export function useProcessLimits() {
  return useQuery({
    queryKey: PROCESS_LIMITS_KEY,
    enabled: hubConfigured(),
    staleTime: 60_000,
    queryFn: async () => {
      const u = hubUrl("/process-editor/limits");
      if (u === null) throw new Error("PUBLIC_HUB_URL chưa cấu hình: không gọi Hub");
      const r = await api<ProcessLimits>(u);
      setStagesMax(r.stages_max);
      return r;
    },
  });
}

/** Số bước tối đa hiệu lực (mặc định 22 khi chưa tải được). */
export const useStagesMax = (): number =>
  useProcessLimits().data?.stages_max ?? PROCESS_STAGES_DEFAULT;
