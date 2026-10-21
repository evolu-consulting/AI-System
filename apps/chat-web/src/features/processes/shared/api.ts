// HUB-FR-105…113 · P-a Bước 0: gọi API dùng chung (dò cờ, đọc run, đọc output). Mỗi PF có `api.ts` riêng cho phần của mình.
import { ProcessOutputSchema, type ProcessRunView, ProcessRunViewSchema } from "@ai/contracts/chat";
import { ApiError, api } from "@ai/web-kit/http";
import { frozenModulesOn } from "~/lib/frozen";
import type { EngineState } from "./types";

/**
 * FD2: dò engine bằng route PF1 `GET /processes` (không phụ thuộc `/me/process-inbox` của PF3 — rỗng tới khi PF3 merge).
 * 200 ⇒ on; 404/403 (cờ tắt ⇒ route không mount) ⇒ off; lỗi khác ném (hook coi là `unknown`, thử lại sau).
 */
export async function probeEngine(signal?: AbortSignal): Promise<EngineState> {
  // Module đóng băng tắt (cờ build PUBLIC_FROZEN_MODULES) ⇒ Hub không mount route quy trình: không dò (tránh 404 trong console).
  if (!frozenModulesOn) return "off";
  try {
    await api<unknown>("/processes", { signal });
    return "on";
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 403)) return "off";
    throw err;
  }
}

const runPath = (id: string) => `/process-runs/${encodeURIComponent(id)}`;

export async function fetchRun(id: string, signal?: AbortSignal): Promise<ProcessRunView> {
  return ProcessRunViewSchema.parse(await api<unknown>(runPath(id), { signal }));
}

export async function fetchOutput(runId: string, outputId: string, signal?: AbortSignal) {
  return ProcessOutputSchema.parse(
    await api<unknown>(`${runPath(runId)}/outputs/${encodeURIComponent(outputId)}`, { signal }),
  );
}
