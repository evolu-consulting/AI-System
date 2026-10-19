// HD-FR-91…96 · HD9 plan §1: contract zod CKS (`/pack/contracts/cks/**`). Hình trả về = `mgmt-app/web/src/api/{cks,cksPrices}.ts`
// (id là uuid). Tiền là số nguyên đồng (BR-1, D9-18): `CksMoney` 0…10¹⁰. Thân vào strict (khoá lạ như `tenant_id` ⇒ 400).
import { z } from "zod";
import { IsoDateSchema as IsoDate, nfcText } from "./fields";

/** Ngày có thật, năm 1900–2999 (review m2: năm 0000 ⇒ Postgres 22008 ⇒ 500; gia hạn +5 năm không vượt năm 9999). */
const CksDate = IsoDate.refine((v) => v >= "1900" && v < "3000", {
  message: "năm ngoài 1900–2999",
});

export const CKS_MONEY_MAX = 10_000_000_000;
export const CksMoney = z.number().int().min(0).max(CKS_MONEY_MAX);
export const CKS_DEVICES = ["token", "remote"] as const;
export const CksDevice = z.enum(CKS_DEVICES);
export type CksDevice = z.infer<typeof CksDevice>;
export const CKS_CERT_STATUSES = ["active", "pending_renewal", "replaced", "revoked"] as const;
export const CKS_RENEWAL_STATUSES = ["open", "done", "lost"] as const;
export const CKS_DOC_KINDS = ["invoice", "tax_return", "contract", "other"] as const;
export const CKS_CUSTOMER_FILTERS = ["expiring", "expired", "elsewhere"] as const;
export const CKS_PACKAGE_FILTERS = ["all", "1y", "multi", "token", "remote"] as const;
export const CKS_UPLOAD_MAX_FILES = 50;
/** S10 mặc định 50 khách/trang (Pager mgmt: 25/50/100). */
export const CKS_PAGE_SIZE = 50;
export const CKS_UPLOAD_FILE_MAX_BYTES = 20 * 1024 * 1024;
export const CKS_UPLOAD_BODY_MAX_BYTES = 64 * 1024 * 1024;

/** Mã lỗi riêng CKS → HTTP. */
export const CKS_ERRORS = {
  CKS_STOCK: 409,
  CKS_SERIAL_TAKEN: 409,
  CKS_RENEWAL_OPEN: 409,
  CKS_RENEWAL_CLOSED: 409,
  CKS_DATES: 422,
} as const;
export type CksErrorCode = keyof typeof CKS_ERRORS;

const optText = (n: number) =>
  nfcText(n)
    .nullish()
    .transform((v) => (v ? v : null));
/** MST Việt Nam — port `mgmt-app/api/app/companies/registry.py::normalize_tax_id` (D9-20, review M2): bỏ khoảng trắng/chấm;
 *  10 số (doanh nghiệp), 12 số (cá nhân), 10-3 (chi nhánh; 13 số liền ⇒ thêm gạch). Sai dạng ⇒ `null`. */
export function normalizeTaxId(raw: string | null | undefined): string | null {
  const s = (raw ?? "").replace(/[\s.]/g, "");
  if (s.includes("-") && !/^\d{10}-\d{3}$/.test(s)) return null;
  const digits = s.replace("-", "");
  if (!/^\d+$/.test(digits)) return null;
  if (digits.length === 13) return `${digits.slice(0, 10)}-${digits.slice(10)}`;
  return digits.length === 10 || digits.length === 12 ? digits : null;
}
/** Trống ⇒ null; có giá trị mà sai dạng MST ⇒ 400 `VALIDATION` tại đúng trường (không thành khoá khách rác, không 500). */
const taxId = () =>
  z
    .string()
    .max(30)
    .nullish()
    .transform((v, ctx) => {
      if (!v?.trim()) return null;
      const n = normalizeTaxId(v);
      if (n === null) {
        ctx.addIssue({
          code: "custom",
          message: "Mã số thuế không hợp lệ (10, 12 hoặc 10-3 chữ số)",
        });
        return z.NEVER;
      }
      return n;
    });

// ---------- vào ----------
export const CksLotCreateSchema = z.strictObject({
  ca: nfcText(60).pipe(z.string().min(1)),
  supplier_name: optText(200),
  supplier_tax_id: taxId(),
  qty: z.number().int().min(1).max(100_000),
  unit_cost: CksMoney,
  years: z.number().int().min(1).max(5).default(1),
  bought_at: CksDate,
  label: optText(40),
  device: CksDevice.default("token"),
});
export type CksLotCreate = z.infer<typeof CksLotCreateSchema>;

export const CksHolderSchema = z.strictObject({
  name: nfcText(200).pipe(z.string().min(1)),
  title: optText(200),
  device: CksDevice.default("token"),
  serial: optText(100),
  keeper: optText(200),
});
export const CksSaleCreateSchema = z.strictObject({
  company_name: nfcText(200).pipe(z.string().min(1)),
  company_tax_id: taxId(),
  lot_id: z.uuid(),
  price_each: CksMoney,
  signed_at: CksDate,
  valid_to: CksDate,
  holders: z.array(CksHolderSchema).min(1).max(200),
});
export type CksSaleCreate = z.infer<typeof CksSaleCreateSchema>;
export const CksSaleCreatedSchema = z.object({ contract_id: z.uuid(), number: z.string() });
export type CksSaleCreated = z.infer<typeof CksSaleCreatedSchema>;

export const CksCertCreateSchema = z.strictObject({
  company_name: nfcText(200).pipe(z.string().min(1)),
  company_tax_id: taxId(),
  ca: nfcText(60).pipe(z.string().min(1)),
  serial: optText(100),
  valid_to: CksDate,
  holder_name: nfcText(200).pipe(z.string().min(1)).default("Chữ ký công ty"),
  device: CksDevice.default("token"),
});
export type CksCertCreate = z.infer<typeof CksCertCreateSchema>;

/** Giờ địa phương `YYYY-MM-DD[THH:mm]`: ngày có thật + giờ 00–23, phút 00–59 (review m2: không để SQL ép kiểu lỗi ⇒ 500). */
const localAt = (timeRequired: boolean) =>
  z
    .string()
    .regex(timeRequired ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/ : /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/)
    .refine((v) => CksDate.safeParse(v.slice(0, 10)).success, { message: "ngày không có thật" })
    .refine(
      (v) => v.length === 10 || (Number(v.slice(11, 13)) <= 23 && Number(v.slice(14, 16)) <= 59),
      {
        message: "giờ không hợp lệ",
      },
    );
const LocalAt = localAt(false);
export const CksRenewSchema = z.strictObject({
  price_each: CksMoney.nullish(),
  years: z.number().int().min(1).max(5).default(1),
  remind_at: LocalAt.nullish(),
});
export type CksRenew = z.infer<typeof CksRenewSchema>;
export const CksCompleteSchema = z.strictObject({
  serials: z.record(z.uuid(), nfcText(100)).default({}),
  valid_to: CksDate.nullish(),
});
export type CksComplete = z.infer<typeof CksCompleteSchema>;
export const CksLostSchema = z.strictObject({ reason: nfcText(500).pipe(z.string().min(1)) });
export const CksFollowupSchema = z.strictObject({
  at: localAt(true),
  note: optText(200),
});
export type CksFollowup = z.infer<typeof CksFollowupSchema>;
export const CksScanSchema = z.strictObject({
  scope: z.enum(["package", "market"]).default("package"),
  ca: z.string().trim().max(60).nullish(),
  years: z.number().int().min(1).max(5),
  device: CksDevice,
});

export const CksCustomersQuerySchema = z.strictObject({
  filter: z.enum(CKS_CUSTOMER_FILTERS).optional(),
  lot: z.uuid().optional(),
  ca: nfcText(60).pipe(z.string().min(1)).optional(),
  /** Tìm bỏ dấu trên tên khách, CA, người giữ, chức danh, serial. */
  q: nfcText(200).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(CKS_PAGE_SIZE),
});
export type CksCustomersQuery = z.infer<typeof CksCustomersQuerySchema>;
export const CksSignedDocsQuerySchema = z.strictObject({
  customer_id: z.uuid(),
  certificate_id: z.uuid().optional(),
  kind: z.enum(CKS_DOC_KINDS).optional(),
});
export const CksPricesQuerySchema = z.strictObject({
  filter: z.enum(CKS_PACKAGE_FILTERS).default("all"),
});
export type CksPackageFilter = (typeof CKS_PACKAGE_FILTERS)[number];

// ---------- ra (khớp mgmt `api/cks.ts`, `api/cksPrices.ts`) ----------
export type CksOverview = {
  certificates: number;
  customers: number;
  expiring_30: number;
  expired: number;
  in_stock: number;
};
export type CksCert = {
  id: string;
  company_id: string;
  serial: string | null;
  ca: string;
  device: CksDevice;
  holder_name: string;
  holder_title: string | null;
  label: string;
  valid_from: string | null;
  valid_to: string;
  sale_price: number | null;
  signed_count: number;
  status: (typeof CKS_CERT_STATUSES)[number];
  keeper: string | null;
  source: "ours" | "elsewhere";
  lot_id: string | null;
  sale_contract_id: string | null;
};
export type CksSaleGroup = {
  contract_id: string;
  number: string | null;
  signed_at: string | null;
  count: number;
  price_each: number | null;
  total: number | null;
  paid: boolean;
  valid_to: string | null;
  renewal: { id: string; status: (typeof CKS_RENEWAL_STATUSES)[number] } | null;
};
export type CksCustomer = {
  company_id: string;
  name: string;
  cert_count: number;
  group_count: number;
  ca: string;
  earliest: string;
  days_left: number;
  sale_price: number | null;
  signed_count: number;
  elsewhere: boolean;
  has_sale: boolean;
  sales: CksSaleGroup[];
  certs: CksCert[];
};
/** Chữ ký trong danh sách S10: chỉ cột màn hiện (`CksPage.tsx:176-187`); đủ trường ở `GET /customers/:id`. */
export type CksCertBrief = Pick<
  CksCert,
  "id" | "label" | "device" | "ca" | "valid_to" | "sale_price" | "signed_count" | "sale_contract_id"
>;
export type CksCustomerBrief = Omit<CksCustomer, "certs"> & { certs: CksCertBrief[] };
/** `GET /customers`: một trang khách (HD9-AC09) + mọi CA để lọc. */
export type CksCustomerPage = {
  items: CksCustomerBrief[];
  total: number;
  page: number;
  page_size: number;
  cas: string[];
};
export type CksLot = {
  id: string;
  label: string;
  ca: string;
  qty: number;
  sold: number;
  customers: number;
  in_stock: number;
  unit_cost: number;
  margin: number | null;
  years: number;
  device: CksDevice;
  bought_at: string;
  purchase_contract_id: string;
};
export type CksRenewal = {
  id: string;
  sale_contract_id: string;
  company_id: string;
  certificate_ids: string[];
  status: (typeof CKS_RENEWAL_STATUSES)[number];
  new_contract_id: string;
  price_each: number;
  valid_to: string;
  lost_reason: string | null;
  done_at: string | null;
};
export type CksSignedDoc = {
  id: string;
  certificate_id: string | null;
  kind: (typeof CKS_DOC_KINDS)[number];
  number: string | null;
  title: string;
  signed_at: string | null;
  source: "xml" | "pdf";
  contract_id: string | null;
};
export type CksUploadResult = {
  added: number;
  skipped: number;
  unmatched: number;
  unreadable: number;
};
export type CksScanJob = {
  id: string;
  ca: string;
  years: number;
  device: CksDevice;
  state: "queued" | "running" | "done" | "error" | "interrupted";
  by: string;
  created_at: string;
  finished_at: string | null;
  n_found: number | null;
  n_verified: number | null;
  error: string | null;
};
export type CksMarketRange = {
  min: number;
  max: number;
  n: number;
  seen: string;
  any_device: boolean;
  sources: {
    seller: string;
    tier: string | null;
    price: number;
    url: string | null;
    kind: "new" | "renew" | null;
  }[];
};
export type CksPackageRow = {
  label: string;
  ca: string;
  years: number;
  device: CksDevice;
  device_label: string;
  buy: number;
  sell: number | null;
  margin: number | null;
  margin_pct: number | null;
  sold: number;
  revenue: number;
  profit: number;
  market: CksMarketRange | null;
  flags: ("cheapest_buy" | "above_market")[];
};
export type CksPrices = {
  stats: { sold_12m: number; revenue: number; gross_profit: number; margin_pct: number | null };
  rows: CksPackageRow[];
  market_seen: string | null;
};
