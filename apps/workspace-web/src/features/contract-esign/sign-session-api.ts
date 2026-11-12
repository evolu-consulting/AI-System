// CR-127 · U6 · M2d · API phiên ký chung (P2): `GET /contracts/:id/sign-session` · `POST …/cancel` · `POST …/respond`.
import { api } from "@ai/web-kit/http";
import type { SignSession } from "./lib/sign-session-view";

const base = (id: string) => `/pack/contracts/contracts/${encodeURIComponent(id)}/sign-session`;
export const signSessionKey = (id: string) => ["contracts", "sign-session", id] as const;

export type SessionResponse = {
  session: SignSession | null;
  signers: { id: string; name: string }[];
};
export const fetchSignSession = (id: string, signal?: AbortSignal) =>
  api<SessionResponse>(base(id), { ...(signal ? { signal } : {}) });
export const cancelSignSession = (id: string, reason: string) =>
  api<{ ok: true }>(`${base(id)}/cancel`, { method: "POST", body: { reason } });
export const respondSignSession = (
  id: string,
  body: { choice: "accept" | "normal" | "decline"; signer_user_id?: string; reason?: string },
) => api<{ ok: true }>(`${base(id)}/respond`, { method: "POST", body });
