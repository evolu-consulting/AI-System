// CR-122 · U2 · client bảng node (`GET /process-palette`, N1) + gợi ý cầu nối (`POST /process-defs/bridge-suggest`, N2).
import type { AppNodeDecl } from "@ai/contracts/app-manifest";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/http";
import { hubConfigured, hubUrl } from "@/lib/hub";
import type { BridgeSuggestion } from "./lib/palette-node";

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

/** Yêu cầu gợi ý cầu nối cho MỘT cạnh lệch (hợp đồng N2: node trước/sau + các lỗi `edgeIssues`); không có gợi ý ⇒ null. */
export type BridgeRequest = {
  app: string;
  from_node: string | null;
  to_node: string;
  issues: { key: string; rule: "missing" | "type"; expected?: string; got?: string }[];
};
export const bridgeSuggest = (body: BridgeRequest): Promise<BridgeSuggestion | null> =>
  api<{ suggestion: BridgeSuggestion | null }>(url("/process-defs/bridge-suggest"), {
    method: "POST",
    body,
  }).then((r) => r.suggestion);
