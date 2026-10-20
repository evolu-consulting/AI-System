// V2-F · HD-11 · HD-04: mốc HĐ (V2-A `POST /contracts/:id/milestones`, `PATCH|DELETE /milestones/:id`) + xác nhận xong mốc
// (`POST /obligations/:id/settle` có `fault` khi trễ). Bearer + refresh do web-kit lo.
import type { MilestoneCreate, MilestonePatch } from "@ai/contracts";
import { api } from "@ai/web-kit/http";

const BASE = "/pack/contracts";

export const addMilestone = (contractId: string, body: MilestoneCreate) =>
  api<unknown>(`${BASE}/contracts/${encodeURIComponent(contractId)}/milestones`, {
    method: "POST",
    body,
  });
export const editMilestone = (id: string, body: MilestonePatch) =>
  api<unknown>(`${BASE}/milestones/${encodeURIComponent(id)}`, { method: "PATCH", body });
export const removeMilestone = (id: string) =>
  api<void>(`${BASE}/milestones/${encodeURIComponent(id)}`, { method: "DELETE" });

export type Fault = "partner" | "ours" | "unknown";
export const settleMilestone = (id: string, body: { at: string; fault?: Fault }) =>
  api<unknown>(`${BASE}/obligations/${encodeURIComponent(id)}/settle`, { method: "POST", body });
