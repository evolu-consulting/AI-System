// HD-FR-96 · S08 · định dạng và luật hiển thị của tab giá CKS — port `CksPricesTab.tsx:11-54`.
import type { CksPackageRow, CksScanJob } from "@ai/contracts";

/** "12,5 tr" cho ô số liệu (`CksPricesTab.tsx:37`). */
export const tr = (n: number): string =>
  `${(n / 1e6).toLocaleString("vi-VN", { maximumFractionDigits: 2, minimumFractionDigits: 1 })} tr`;

export const active = (j: CksScanJob): boolean => j.state === "queued" || j.state === "running";
export const same = (j: CksScanJob, r: CksPackageRow): boolean =>
  j.ca === r.ca && j.years === r.years && j.device === r.device;

/** Nền hàng: bán cao hơn thị trường > giá mua thấp nhất. */
export function rowTone(r: CksPackageRow): string {
  if (r.flags.includes("above_market")) return "bg-soon-bg/60";
  if (r.flags.includes("cheapest_buy")) return "bg-ok-bg/60";
  return "";
}

/** Lượt dò hiện trên dải (`ScanStrip`, `CksPricesTab.tsx:16-19`): bỏ lượt bị ngắt, giữ lượt đang chạy hoặc trong 6 giờ, ≤ 3. */
export function stripJobs(jobs: CksScanJob[], now = Date.now()): CksScanJob[] {
  return jobs
    .filter(
      (j) =>
        j.state !== "interrupted" && (active(j) || now - Date.parse(j.created_at) < 6 * 3600e3),
    )
    .slice(0, 3);
}
