import { useQuery } from "@tanstack/react-query";
import type { Band } from "@/components/ui";
import { api, qs, send } from "./client";

export type PriceProduct = { key: string; label: string; unit: string | null };
export type PriceRow = {
  supplier: string; supplier_company_id: string | null; price: number; unit: string | null;
  score: number | null; band: Band | null; is_new: boolean; ai_suggested?: boolean;
  source: { type: "contract" | "quote" | "website"; date: string | null; contract_id?: string; quote_id?: string; url?: string };
};
export type Compare = { product: PriceProduct; rows: PriceRow[];
  market: { status: "ok" | "tbd"; min?: number; max?: number; seen?: string | null } };

export const usePriceProducts = () => useQuery({ queryKey: ["prices", "products"], queryFn: () => api<PriceProduct[]>("/prices/products") });
export const useCompare = (product: string | null) => useQuery({
  queryKey: ["prices", "compare", product], enabled: !!product,
  queryFn: () => api<Compare>(`/prices/compare${qs({ product })}`),
});

export type NewQuote = { product: string; supplier_name: string; supplier_tax_id?: string; price: number;
  quoted_at: string; url?: string; note?: string };
export const addQuote = (q: NewQuote) => api<{ id: string }>("/prices/quotes", send(q));
