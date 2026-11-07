// CR-124 · q4 · API hộp «Hợp đồng đối tác gửi» + vòng gửi + ghi nhận thủ công (`/pack/contracts/partner/*`).
import { api } from "@ai/web-kit/http";
import type { InboxItem, Invite, Round } from "./lib/partner-view";
import type { ReceiveSettings } from "./lib/receive-settings";

const BASE = "/pack/contracts/partner";
export const partnerKeys = {
  inbox: ["contracts", "partner", "inbox"] as const,
  rounds: (id: string) => ["contracts", "partner", "rounds", id] as const,
};

export type RecordIn = {
  outcome: "confirmed" | "returned" | "declined";
  reason?: string;
  by_name: string;
  by_title?: string;
  evidence: { name: string; note?: string }[];
};

export const fetchInbox = (signal?: AbortSignal) =>
  api<{ items: InboxItem[]; invites: Invite[] }>(`${BASE}/inbox`, {
    ...(signal ? { signal } : {}),
  });
export const answerInvite = (from: string, act: "accept" | "block") =>
  api<{ ok: true }>(`${BASE}/invites/${encodeURIComponent(from)}/${act}`, { method: "POST" });
export const fetchRounds = (contractId: string, signal?: AbortSignal) =>
  api<{ rounds: Round[] }>(`${BASE}/sends/${encodeURIComponent(contractId)}`, {
    ...(signal ? { signal } : {}),
  });
export const recordResult = (mailboxId: string, body: RecordIn) =>
  api<{ ok: true }>(`${BASE}/sends/${encodeURIComponent(mailboxId)}/record`, {
    method: "POST",
    body,
  });

export const fetchReceiveSettings = () => api<ReceiveSettings>(`${BASE}/settings`);
export const saveReceiveSettings = (s: ReceiveSettings) =>
  api<{ ok: true }>(`${BASE}/settings`, { method: "PUT", body: s });
