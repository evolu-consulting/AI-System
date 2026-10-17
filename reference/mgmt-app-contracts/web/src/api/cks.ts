import { useQuery } from "@tanstack/react-query";
import { api, qs, send } from "./client";

export type Overview = { certificates: number; customers: number; expiring_30: number; expired: number; in_stock: number };
export type Cert = {
  id: string; serial: string; ca: string; device: "token" | "remote"; holder_name: string | null; holder_title: string | null;
  label: string; valid_to: string; sale_price: number | null; signed_count: number; status: string;
  keeper: string | null;
};
export type SaleGroup = { contract_id: string; number: string; signed_at: string | null; count: number; price_each: number | null;
  total: number | null; paid: boolean; valid_to: string | null; renewal: { id: string; status: "open" | "done" | "lost" } | null };
export type CksCustomer = {
  company_id: string; name: string; cert_count: number; group_count: number; ca: string; earliest: string; days_left: number;
  sale_price: number | null; signed_count: number; elsewhere: boolean; has_sale: boolean;
  sales: SaleGroup[]; certs: (Cert & { sale_contract_id: string | null })[];
};
export type Lot = { id: string; label: string; ca: string; qty: number; sold: number; customers: number; in_stock: number;
  unit_cost: number; margin: number | null; years: number; device?: "token" | "remote" };
export type SignedDoc = { id: string; certificate_id: string | null; kind: "invoice" | "tax_return" | "contract" | "other";
  number: string | null; title: string; signed_at: string | null; source: "xml" | "pdf"; contract_id: string | null };

export type CksFilter = { filter?: "expiring" | "expired" | "elsewhere"; lot?: string; ca?: string };

export const useOverview = () => useQuery({ queryKey: ["cks", "overview"], queryFn: () => api<Overview>("/cks/overview") });
export const useCksCustomers = (f: CksFilter) =>
  useQuery({ queryKey: ["cks", "customers", f], queryFn: () => api<CksCustomer[]>(`/cks/customers${qs(f)}`) });
export const useCksCustomer = (id: string) =>
  useQuery({ queryKey: ["cks", "customer", id], queryFn: () => api<CksCustomer>(`/cks/customers/${encodeURIComponent(id)}`) });
export const useLots = () => useQuery({ queryKey: ["cks", "lots"], queryFn: () => api<Lot[]>("/cks/lots") });
export const useSignedDocs = (company_id: string, certificate_id?: string, kind?: string) => useQuery({
  queryKey: ["signed", company_id, certificate_id, kind],
  queryFn: () => api<SignedDoc[]>(`/signed-docs${qs({ company_id, certificate_id, kind })}`),
});

export type NewLot = { ca: string; supplier_name: string; qty: number; unit_cost: number; years: number; bought_at: string; label?: string;
  device: "token" | "remote" };
export const createLot = (b: NewLot) => api<Lot>("/cks/lots", send(b));
export type NewSale = { company_name: string; company_tax_id?: string; lot_id: string; price_each: number; signed_at: string;
  valid_to: string; holders: { name: string; title?: string; device: "token" | "remote"; serial?: string }[] };
export const createSale = (b: NewSale) => api<{ contract_id: string }>("/cks/sales", send(b));
export const renewGroup = (saleId: string, price_each?: number, remind_at?: string) =>
  api<{ id: string }>(`/cks/groups/${saleId}/renew`, send({ price_each, remind_at }));
export const completeRenewal = (id: string, serials: Record<string, string>, valid_to: string | null) =>
  api<unknown>(`/cks/renewals/${id}/complete`, send({ serials, valid_to }));

export async function uploadSigned(files: FileList | File[]) {
  const f = new FormData();
  for (const x of Array.from(files)) f.append("files", x);
  return api<{ added: number; skipped: number; unmatched: number; unreadable: number }>("/signed-docs/upload", { method: "POST", body: f });
}
