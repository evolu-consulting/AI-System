import { useQuery } from "@tanstack/react-query";
import { api, qs, send } from "./client";

export type ScanJob = { id: string; ca: string; years: number; device: "token" | "remote";
  state: "queued" | "running" | "done" | "error" | "interrupted"; by: string; created_at: string; finished_at: string | null;
  n_found: number | null; n_verified: number | null; error: string | null };

/** Recent "Dò giá" runs; polled every 5 s while one is still going. */
export const useScans = () =>
  useQuery({ queryKey: ["prices", "scans"], queryFn: () => api<ScanJob[]>("/prices/cks/scans"),
    refetchInterval: (q) => (q.state.data?.some((j) => j.state === "queued" || j.state === "running") ? 5000 : false) });

export const startScan = (ca: string, years: number, device: string) =>
  api<ScanJob>("/prices/cks/scan", send({ ca, years, device }));
export const WHOLE_MARKET = "*";
export const startMarketScan = (years: number, device: string) =>
  api<ScanJob>("/prices/cks/scan", send({ scope: "market", years, device }));

export type MarketRow = { ca: string; ca_name: string; min: number; min_new: number | null; min_renew: number | null; n: number;
  seen: string; ours: number | null; known: boolean;
  cheapest: { seller: string; url: string | null; tier: string | null; kind: "new" | "renew" | null; price: number } };
export type MarketBoard = { years: number; device: string; rows: MarketRow[]; market_seen: string | null };
export const useMarket = (years: number, device: string) =>
  useQuery({ queryKey: ["prices", "cks", "market", years, device],
    queryFn: () => api<MarketBoard>(`/prices/cks/market${qs({ years, device })}`) });

export type PackageRow = {
  label: string; ca: string; years: number; device: "token" | "remote"; device_label: string;
  buy: number; sell: number | null; margin: number | null; margin_pct: number | null; sold: number;
  market: { min: number; max: number; n: number; seen: string; any_device: boolean;
    sources: { seller: string; tier: string | null; price: number; url: string | null }[] } | null;
  flags: ("cheapest_buy" | "above_market")[];
};
export type CksPrices = { stats: { sold_12m: number; revenue: number; gross_profit: number; margin_pct: number | null };
  rows: PackageRow[]; market_seen: string | null };
export type PackageFilter = "all" | "1y" | "multi" | "token" | "remote";

export const useCksPrices = (filter: PackageFilter) =>
  useQuery({ queryKey: ["prices", "cks", filter], queryFn: () => api<CksPrices>(`/prices/cks${qs({ filter })}`) });
