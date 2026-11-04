// W1 · "Mua hàng": `GET /pack/contracts/sourcing` (trang tính ở máy chủ) + `PUT /pack/contracts/sourcing/:contractId/:line` (đổi nguồn).
import type { SourcingOut } from "@ai/contracts";
import { api } from "@ai/web-kit/http";

const BASE = "/pack/contracts/sourcing";
export type SourcingParams = {
  q?: string;
  risk?: boolean;
  contract?: string;
  page: number;
  page_size: number;
};
export const sourcingKeys = {
  all: ["sourcing"] as const,
  list: (p: SourcingParams) => ["sourcing", p] as const,
};

const qs = (p: SourcingParams) => {
  const u = new URLSearchParams();
  if (p.q?.trim()) u.set("q", p.q.trim());
  if (p.risk) u.set("risk", "1");
  if (p.contract) u.set("contract", p.contract);
  u.set("page", String(p.page));
  u.set("page_size", String(p.page_size));
  return `?${u.toString()}`;
};

export const fetchSourcing = (p: SourcingParams, signal?: AbortSignal) =>
  api<SourcingOut>(`${BASE}${qs(p)}`, { signal });
export const chooseSource = (
  contractId: string,
  line: number,
  src: { contract_id: string; line: number } | null,
) =>
  api<{ ok: true }>(`${BASE}/${encodeURIComponent(contractId)}/${line}`, {
    method: "PUT",
    body: src ?? { contract_id: null },
  });
