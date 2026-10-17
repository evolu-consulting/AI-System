import { useQuery } from "@tanstack/react-query";
import type { Band } from "@/components/ui";
import { api, qs, send } from "./client";

export type Role = "customer" | "supplier";
export type Partner = { company_id: string; name: string; roles: Role[]; role: Role; score: number | null; band: Band | null;
  reason: string; event_count: number };

/** GET /partners (PLAN T04): one row per company and role, scored from its events. */
export const usePartners = (role: Role | "all") =>
  useQuery({ queryKey: ["partners", role], queryFn: () => api<Partner[]>(`/partners${qs({ role })}`) });

/** "auto": computed from the ledger and contracts; "manual": added by the owner, a person rates each partner 0–100. */
export type Criterion = { key: string; kind: "auto" | "manual"; label: string; enabled: boolean; weight: number };
export type ScoreRules = { good_from: number; fair_from: number; min_events: number; window_months: number;
  recency_boost: boolean; recency_months: number; manual_adjust: boolean };
export type ScoreConfig = { role: Role; version: number; criteria: Criterion[]; rules: ScoreRules;
  updated_by: string | null; updated_at: string | null;
  /** Built-ins the owner removed, with their default weight. */
  restorable: { key: string; label: string; weight: number }[];
  /** the hand-rated criteria this role may add, by name (no free text) */
  manual_choices: string[] };
export type Preview = { changes: { company_id: string; name: string; old: number | null; new: number | null;
  band_old: Band | null; band_new: Band | null }[]; changed_band: number; total: number };
export type ConfigChange = { version: number; at: string; by: string; summary: string };

export const useScoring = (role: Role) =>
  useQuery({ queryKey: ["scoring", role], queryFn: () => api<ScoreConfig>(`/scoring/${role}`) });
export const useScoringHistory = (role: Role) =>
  useQuery({ queryKey: ["scoring", role, "history"], queryFn: () => api<ConfigChange[]>(`/scoring/${role}/history`) });
export const previewScoring = (role: Role, cfg: Pick<ScoreConfig, "criteria" | "rules">) =>
  api<Preview>(`/scoring/${role}/preview`, send(cfg));
export const saveScoring = (role: Role, cfg: Pick<ScoreConfig, "criteria" | "rules">) =>
  api<ScoreConfig>(`/scoring/${role}`, send(cfg, "PUT"));

export type RatingEntry = { id: string; value: number; note: string | null; by: string; at: string; rated_at: string | null };
export type PartnerRatings = {
  criteria: { key: string; label: string; weight: number; enabled: boolean;
    current: (RatingEntry & { counts: boolean }) | null }[];
  history: (RatingEntry & { criterion: string; label: string })[];
};

/** GET /partners/{cid}/ratings: the role's hand-rated criteria with this partner's latest rating, and every rating. */
export const usePartnerRatings = (companyId: string, role: Role) =>
  useQuery({ queryKey: ["partners", companyId, "ratings", role],
    queryFn: () => api<PartnerRatings>(`/partners/${encodeURIComponent(companyId)}/ratings${qs({ role })}`) });
export const ratePartner = (companyId: string, body: { role: Role; criterion: string; value: number; note?: string }) =>
  api<RatingEntry>(`/partners/${encodeURIComponent(companyId)}/ratings`, send(body, "PUT"));

// ---- "+ Ghi việc": what happened with a partner, recorded by hand (feeds the reputation) ----

export type Instalment = { id: string; contract_id: string; contract_number: string | null; direction: "pay" | "receive";
  kind: "payment" | "delivery"; seq: number; due_date: string; amount: number | null; status: "open" | "done" | "cancelled";
  done_at: string | null; postpones?: number; reminders?: number;
  /** read from the payment terms when the contract was confirmed: a date hanging on delivery etc. is an estimate */
  estimated?: boolean; basis?: string };
export type PartnerEvent = { id: string; type: string; at: string; by: string; note: string | null; days_late: number | null;
  amount: number | null; contract_id: string | null; obligation_id: string | null; voided: boolean; to?: string;
  value?: number; criterion?: string;
  /** "action" a person's click · "assistant" asked in chat · "system" the app by itself · "seed" sample data */
  source?: string;
  /** "overdue" lines: the date that passed, whose lateness it is, which instalment */
  due_date?: string; party_late?: boolean; kind?: string; seq?: number };

/** Open instalments with one partner (every contract the person sees, or one contract). */
export const useInstalments = (companyId: string, contractId?: string) =>
  useQuery({ queryKey: ["partners", companyId, "instalments", contractId ?? ""],
    queryFn: () => api<Instalment[]>(`/obligations${qs({ company_id: companyId, contract_id: contractId, status: "open" })}`) });
export const usePartnerEvents = (companyId: string) =>
  useQuery({ queryKey: ["partners", companyId, "events"],
    queryFn: () => api<PartnerEvent[]>(`/partner-events${qs({ company_id: companyId })}`) });
/** The partner a contract is with: the buyer of a sale, the supplier of a purchase. */
export const useContractPartner = (contractId: string) =>
  useQuery({ queryKey: ["contract", contractId, "partner"],
    queryFn: () => api<{ company_id: string | null; role: Role; name: string | null }>(`/partner-events/contract/${encodeURIComponent(contractId)}`) });

export const settleInstalment = (id: string, at: string) => api(`/obligations/${id}/settle`, send({ at }));
export const remindInstalment = (id: string) => api(`/obligations/${id}/remind`, send({}));
export const postponeInstalment = (id: string, to: string, note?: string) => api(`/obligations/${id}/postpone`, send({ to, note }));
export const recordEvent = (body: { company_id: string; role: Role; type: string; at: string; days_late?: number;
  note?: string; contract_id?: string }) => api<PartnerEvent>("/partner-events", send(body));
export const voidEvent = (id: string) => api<PartnerEvent>(`/partner-events/${id}/void`, send({}));

/** Labels and hints of the built-in criteria, as p06 words them. */
export const CRITERIA: Record<string, { label: string; hint: string }> = {
  payment_on_time: { label: "Thanh toán đúng hạn", hint: "% đợt trả đúng hạn, trừ thêm theo số ngày trễ" },
  cks_renewal: { label: "Gia hạn chữ ký số", hint: "Gia hạn trước khi hết hạn và gia hạn qua mình" },
  reminders: { label: "Số lần phải nhắc", hint: "Nhắc thanh toán, nhắc nghĩa vụ trên mỗi hợp đồng" },
  appointments: { label: "Giữ lịch hẹn", hint: "% cuộc hẹn không bị dời hoặc hủy" },
  tenure: { label: "Gắn bó", hint: "Thời gian hợp tác, số hợp đồng" },
  complaints: { label: "Khiếu nại, tranh chấp", hint: "Số lần phát sinh, trừ điểm mỗi lần" },
  delivery_on_time: { label: "Giao hàng đúng hạn", hint: "% lần giao đúng hạn" },
  price: { label: "Giá cạnh tranh", hint: "Giá đang áp dụng so với nơi rẻ nhất cùng mặt hàng (hợp đồng, báo giá)" },
};
