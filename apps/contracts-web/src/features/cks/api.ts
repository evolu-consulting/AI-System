// HD-FR-91…95 · S10/S11: gọi `/pack/contracts/cks/**` (Bearer + refresh do web-kit). Hình dữ liệu = `@ai/contracts` (cks.ts).
import type {
  CksCertCreate,
  CksCustomer,
  CksCustomerPage,
  CksLot,
  CksLotCreate,
  CksOverview,
  CksRenewal,
  CksSaleCreate,
  CksSaleCreated,
  CksSignedDoc,
  CksUploadResult,
} from "@ai/contracts";
import { api } from "@ai/web-kit/http";

const BASE = "/pack/contracts/cks";
export type CustomerQuery = {
  filter?: "expiring" | "expired" | "elsewhere";
  lot?: string;
  ca?: string;
  q?: string;
  page: number;
  page_size: number;
};

const qs = (o: Record<string, string | number | undefined>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
};

export const cksKeys = {
  all: ["cks"] as const,
  overview: ["cks", "overview"] as const,
  customers: (q: CustomerQuery) => ["cks", "customers", q] as const,
  customer: (id: string) => ["cks", "customer", id] as const,
  lots: ["cks", "lots"] as const,
  signed: (customer: string, cert?: string) => ["cks", "signed", customer, cert ?? null] as const,
};

export const fetchOverview = (signal?: AbortSignal) =>
  api<CksOverview>(`${BASE}/overview`, { signal });
export const fetchCustomers = (q: CustomerQuery, signal?: AbortSignal) =>
  api<CksCustomerPage>(`${BASE}/customers${qs(q)}`, { signal });
export const fetchCustomer = (id: string, signal?: AbortSignal) =>
  api<CksCustomer>(`${BASE}/customers/${encodeURIComponent(id)}`, { signal });
export const fetchLots = (signal?: AbortSignal) =>
  api<(CksLot & { device: "token" | "remote" })[]>(`${BASE}/lots`, { signal });
export const fetchSignedDocs = (customer: string, cert: string | undefined, signal?: AbortSignal) =>
  api<CksSignedDoc[]>(`${BASE}/signed-docs${qs({ customer_id: customer, certificate_id: cert })}`, {
    signal,
  });

export const createLot = (b: Partial<CksLotCreate>) =>
  api<CksLot>(`${BASE}/lots`, { method: "POST", body: b });
export const createSale = (b: CksSaleCreate) =>
  api<CksSaleCreated>(`${BASE}/sales`, { method: "POST", body: b });
export const addCertificate = (b: CksCertCreate) =>
  api<unknown>(`${BASE}/certificates`, { method: "POST", body: b });
export const renewGroup = (saleId: string, remindAt?: string) =>
  api<CksRenewal>(`${BASE}/groups/${encodeURIComponent(saleId)}/renew`, {
    method: "POST",
    body: remindAt ? { remind_at: remindAt } : {},
  });
export const completeRenewal = (
  id: string,
  serials: Record<string, string>,
  validTo: string | null,
) =>
  api<CksRenewal>(`${BASE}/renewals/${encodeURIComponent(id)}/complete`, {
    method: "POST",
    body: { serials, valid_to: validTo },
  });
export const remindAbout = (customer: string, at: string, note?: string) =>
  api<{ id: string }>(`${BASE}/customers/${encodeURIComponent(customer)}/followups`, {
    method: "POST",
    body: note ? { at, note } : { at },
  });
/** Multipart `files`: web-kit nhận thân thô Blob — `Response(FormData).blob()` giữ `type` có boundary. */
export async function uploadSigned(files: File[]): Promise<CksUploadResult> {
  const f = new FormData();
  for (const x of files) f.append("files", x);
  const rawBody = await new Response(f).blob();
  return api<CksUploadResult>(`${BASE}/signed-docs/upload`, { method: "POST", rawBody });
}
