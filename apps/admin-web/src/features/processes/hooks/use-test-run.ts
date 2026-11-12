// CR-127 · U3 · BR-17 · gọi Hub «Chạy thử» (CHỈ platform_admin, không ghi gì): một lượt có quyết định đóng vai + "Thử nhanh 4 trường hợp".
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/http";
import { hubUrl } from "@/lib/hub";
import type { PreviewResponse, RunRequest, ScenarioResponse } from "../lib/test-run";
import { toScenarioRequest } from "../lib/test-run";

const path = (tid: string, tail = ""): string => {
  const u = hubUrl(`/tenants/${encodeURIComponent(tid)}/flow-preview${tail}`);
  if (u === null) throw new Error("PUBLIC_HUB_URL chưa cấu hình: không gọi Hub");
  return u;
};

export const runTestFlow = (tid: string, body: RunRequest) =>
  api<PreviewResponse>(path(tid), { method: "POST", body });
export const runTestScenarios = (tid: string, body: RunRequest) =>
  api<ScenarioResponse>(path(tid, "/scenarios"), { method: "POST", body: toScenarioRequest(body) });

export function useTestRun(tenantId: string) {
  const run = useMutation({ mutationFn: (b: RunRequest) => runTestFlow(tenantId, b) });
  const scenarios = useMutation({ mutationFn: (b: RunRequest) => runTestScenarios(tenantId, b) });
  return { run, scenarios };
}
