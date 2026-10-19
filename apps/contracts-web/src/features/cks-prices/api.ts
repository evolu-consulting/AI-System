// HD-FR-96 · S08: giá CKS mua–bán (`GET /pack/contracts/cks/prices`) + "Dò giá" (D9-10: chưa có lượt dò, dò mới ⇒ 503).
import type { CksPackageFilter, CksPrices, CksScanJob } from "@ai/contracts";
import { api } from "@ai/web-kit/http";

const BASE = "/pack/contracts/cks";
export const pricesKey = (f: CksPackageFilter) => ["cks", "prices", f] as const;
export const scansKey = ["cks", "scans"] as const;

export const fetchCksPrices = (filter: CksPackageFilter, signal?: AbortSignal) =>
  api<CksPrices>(`${BASE}/prices?filter=${encodeURIComponent(filter)}`, { signal });
export const fetchScans = (signal?: AbortSignal) => api<CksScanJob[]>(`${BASE}/scans`, { signal });
export const startScan = (ca: string, years: number, device: string) =>
  api<CksScanJob>(`${BASE}/scans`, {
    method: "POST",
    body: { scope: "package", ca, years, device },
  });
