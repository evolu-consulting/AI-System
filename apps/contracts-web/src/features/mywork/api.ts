// W1 · "Việc của tôi": `GET /pack/contracts/my-work` + hành động (xong/nhắc lại sau của hẹn nhắc; đã trả/đã thu/khách hẹn lại của sổ HD7).
import type { MyWorkOut } from "@ai/contracts";
import { api } from "@ai/web-kit/http";

const BASE = "/pack/contracts";
export const workKeys = { all: ["my-work"] as const };
const enc = encodeURIComponent;

export const fetchMyWork = (signal?: AbortSignal) => api<MyWorkOut>(`${BASE}/my-work`, { signal });
export const doneFollowup = (id: string) =>
  api<{ ok: true }>(`${BASE}/my-work/followups/${enc(id)}/done`, { method: "POST", body: {} });
export const snoozeFollowup = (id: string, at: string) =>
  api<{ ok: true }>(`${BASE}/my-work/followups/${enc(id)}/snooze`, {
    method: "POST",
    body: { at },
  });
export const settleObligation = (id: string) =>
  api<unknown>(`${BASE}/obligations/${enc(id)}/settle`, { method: "POST", body: {} });
export const postponeObligation = (id: string, to: string) =>
  api<unknown>(`${BASE}/obligations/${enc(id)}/postpone`, { method: "POST", body: { to } });
/** "Hẹn nhắc" về một đợt / HĐ (mgmt-app `POST /followups`): `at` là giờ địa phương `YYYY-MM-DDTHH:mm`. */
export const createFollowup = (kind: "obligation" | "contract", subjectId: string, at: string) =>
  api<{ id: string }>(`${BASE}/followups`, {
    method: "POST",
    body: { subject_kind: kind, subject_id: subjectId, at },
  });
