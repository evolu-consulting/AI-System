// CR-152 · CR-150 · HĐ mẫu «Nhượng quyền» + «Thỏa thuận hợp tác» cho UAT trên tenant demo (stg-test). Luật thuần: dữ liệu mẫu, kế hoạch idempotent, guard.
// IO ở seed-kind-samples.ts. Nhận diện theo TIÊU ĐỀ (không ghi đè HĐ người dùng đã thao tác).
import type {
  CooperationTerms,
  FranchiseTerms,
  KindDeal,
} from "../../../packages/contracts/src/pack-contracts/kind-terms";
import { PROFILES, partnerGuard } from "./seed-demo-partner.data";

export { partnerGuard as kindSamplesGuard };
export const KIND_SAMPLES_TENANT = "demo";
/** Đối tác có sẵn trong sổ đối tác của demo (seed-demo-partner `partnerRow`). */
export const SAMPLE_PARTNER = { name: PROFILES.evolu.legal_name, tax: PROFILES.evolu.tax_code };
export const SAMPLE_SELF = { name: PROFILES.demo.legal_name, tax: PROFILES.demo.tax_code };

export type KindSample = {
  n: number;
  title: string;
  deal: KindDeal;
  direction: "sale" | "purchase";
  /** người tạo + gửi duyệt (đúng vai); người duyệt/ký là quản trị công ty (Toàn quyền, «duyệt thay» đường API). */
  by: string;
  target: "done" | "processing";
  terms: FranchiseTerms | CooperationTerms;
  value: number | null;
};

export const KIND_SAMPLES: readonly KindSample[] = [
  {
    n: 1,
    title: "HĐ mẫu · Nhượng quyền Cà Phê Mẫu",
    deal: "franchise",
    direction: "sale",
    by: "cuong.le",
    target: "done",
    value: 300_000_000,
    terms: {
      role: "franchisor",
      brand: "Cà Phê Mẫu",
      territory: "Hà Nội",
      exclusive: false,
      initial_fee: 300_000_000,
      fee_basis: "revenue_pct",
      fee_pct: 5,
      period: "month",
    },
  },
  {
    n: 2,
    title: "HĐ mẫu · Thỏa thuận hợp tác Logistics miền Tây",
    deal: "cooperation",
    direction: "sale",
    by: "dung.pham",
    target: "processing",
    value: null,
    terms: {
      scope: "Hợp tác vận chuyển và kho bãi khu vực miền Tây",
      our_contribution: "Đơn hàng và hệ thống quản lý vận đơn",
      partner_contribution: "Đội xe và kho trung chuyển",
      split_basis: "profit",
      our_share_pct: 60,
      settle_period: "quarter",
    },
  },
];

export const sampleId = (n: number): string => `c152e000-0000-4000-8000-00000000000${n}`;

const iso = (d: Date): string => d.toISOString().slice(0, 10);
/** Hiệu lực 3 năm từ ngày 1 tháng sau (UTC); `end` = ngày cuối của kỳ 3 năm. */
export function sampleDates(now: Date): { start: string; end: string; signed: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const end = new Date(Date.UTC(start.getUTCFullYear() + 3, start.getUTCMonth(), 0));
  return { start: iso(start), end: iso(end), signed: iso(now) };
}

/** Trường HĐ (`fields`) gửi ở bước «Lưu»: mình = bên cung cấp (thu tiền), đối tác = bên còn lại. */
export function sampleFields(s: KindSample, now: Date): Record<string, string | number> {
  const d = sampleDates(now);
  const f: Record<string, string | number> = {
    title: s.title,
    supplier_name: SAMPLE_SELF.name,
    supplier_tax_id: SAMPLE_SELF.tax,
    buyer_name: SAMPLE_PARTNER.name,
    buyer_tax_id: SAMPLE_PARTNER.tax,
    signed_date: d.signed,
    start_date: d.start,
    effective_date: d.start,
    end_date: d.end,
  };
  if (s.value !== null) f.total_value = s.value;
  return f;
}

export type SampleState = {
  exists: boolean;
  status: "draft" | "processing" | "reject" | "done" | null;
  hasKindTerms: boolean;
  hasFile: boolean;
  hasRun: boolean;
};
export type SampleStep = "create" | "kind_terms" | "file" | "review" | "submit" | "approve_all";

/**
 * Kế hoạch một HĐ mẫu (idempotent): đã `done`/bị từ chối ⇒ [] (người dùng đã thao tác, không làm lại).
 * Đang duyệt: đích `done` ⇒ duyệt + ký tiếp, đích `processing` ⇒ giữ nguyên.
 * Nháp ⇒ làm bước còn thiếu rồi gửi; đích `done` thì thêm `approve_all` (duyệt + ký tới DONE).
 */
export function planSample(s: KindSample, st: SampleState): SampleStep[] {
  if (st.status === "done" || st.status === "reject") return [];
  if (st.status === "processing") return s.target === "done" && st.hasRun ? ["approve_all"] : [];
  const steps: SampleStep[] = [];
  if (!st.exists) steps.push("create");
  if (!st.hasKindTerms) steps.push("kind_terms");
  if (!st.hasFile) steps.push("file");
  steps.push("review", "submit");
  if (s.target === "done") steps.push("approve_all");
  return steps;
}

/** Tệp PDF tối thiểu (có `%PDF-` + `%%EOF`) làm «bản HĐ mẫu». */
export const SAMPLE_PDF =
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n";
