// CR-122 · U2 · client bảng node (`GET /process-palette`, N1) + gợi ý cầu nối (`POST /process-defs/bridge-suggest`, N2).
// Hợp đồng N2 (`packages/contracts/src/hub-admin/process-bridge.ts` ở nhánh cr122-n2-bridge-ai): gửi bản nháp + khoá stage trước/sau;
// nhận `{ok:true, stage, explain_vi, explain_en}` (stage `set` đầy đủ) hoặc `{ok:false, reason_vi, reason_en}`. Khi N2 gộp ⇒ đổi sang
// import schema từ contracts (kiểu dưới đây khớp từng trường).
import type { AppNodeDecl } from "@ai/contracts/app-manifest";
import type { ProcessDefInput, ProcessStageDef } from "@ai/contracts/hub-admin";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/http";
import { hubConfigured, hubUrl } from "@/lib/hub";

const url = (path: string): string => {
  const u = hubUrl(path);
  if (u === null) throw new Error("PUBLIC_HUB_URL chưa cấu hình: không gọi Hub");
  return u;
};

/** Node lõi + node của app có tính năng đang bật cho công ty (platform_admin sửa Thư viện: không `tenantId` ⇒ mọi node). */
export function usePalette(app: string, tenantId: string | undefined) {
  return useQuery({
    queryKey: ["process", "palette", app, tenantId ?? ""] as const,
    enabled: hubConfigured(),
    staleTime: 60_000,
    queryFn: async () =>
      (
        await api<{ items: AppNodeDecl[] }>(url("/process-palette"), {
          query: { app, tenant_id: tenantId },
        })
      ).items,
  });
}

export type BridgeRequest = { def: ProcessDefInput; from: string; to: string };
export type BridgeResult =
  | { ok: true; stage: ProcessStageDef; explain_vi: string; explain_en: string }
  | { ok: false; reason_vi: string; reason_en: string };

export const bridgeSuggest = (body: BridgeRequest): Promise<BridgeResult> =>
  api<BridgeResult>(url("/process-defs/bridge-suggest"), { method: "POST", body });
