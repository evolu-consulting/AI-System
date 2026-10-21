// V2-B · BA v2 §2 (Nhóm sản phẩm, Nguồn hàng và giá vốn) · §5.5 (gắn SP từ dòng HĐ, quy tắc nhận diện, thành phần): danh mục SP.
// `GET /pack/contracts/products`, `GET /products/:id`, `POST /products`, `POST /products/match`, `POST /products/:id/rules`,
// `DELETE /products/:id/rules/:ruleId`. Tiền = số nguyên đồng (chưa VAT); SL = chuỗi thập phân ≤ 4 số lẻ.
import { z } from "zod";

export const PRODUCT_ERRORS = { PRODUCT_EXISTS: 409, PRODUCT_INVALID: 422 } as const;
export type ProductErrorCode = keyof typeof PRODUCT_ERRORS;

/** service = Dịch vụ có hạn · goods = Hàng hoá · referral = Giới thiệu. */
export const PRODUCT_GROUPS = ["service", "goods", "referral"] as const;
export type ProductGroup = (typeof PRODUCT_GROUPS)[number];
/** stock = kho lô · quota = gói suất có hạn · order = không giữ hàng (giá vốn theo đơn) · none = Giới thiệu. */
export const COMPONENT_MODES = ["stock", "quota", "order", "none"] as const;
export type ComponentMode = (typeof COMPONENT_MODES)[number];
export const PRODUCT_COMPONENTS_MAX = 20;
export const PRODUCT_RULES_MAX = 20;
export const PRODUCTS_PAGE_MAX = 200;

const name = z.string().trim().min(1).max(300);
const unit = z.string().trim().min(1).max(40).nullish();
const pattern = z.string().trim().min(2).max(100);

export const ProductComponentInputSchema = z.strictObject({
  name,
  unit,
  mode: z.enum(COMPONENT_MODES).optional(),
});
export const ProductRuleInputSchema = z.strictObject({
  pattern,
  /** Chỉ số thành phần (theo `components`) mà quy tắc trỏ tới; bỏ trống = cả SP. */
  component: z
    .number()
    .int()
    .min(0)
    .max(PRODUCT_COMPONENTS_MAX - 1)
    .nullish(),
});
/** Tạo SP (BA 5.5c: tên + đơn vị từ dòng HĐ, người chọn nhóm; 5.5d: HĐ Mua ⇒ NCC chính). Không có `components` ⇒ một thành phần cùng tên. */
export const ProductCreateSchema = z.strictObject({
  name,
  unit,
  /** gap-d1 #18 · quy cách (thêm SP tay). */
  spec: z.string().trim().min(1).max(500).nullish(),
  group: z.enum(PRODUCT_GROUPS),
  /** Không giữ hàng (BA §2): mọi thành phần mặc định `order`. */
  no_stock: z.boolean().optional(),
  components: z.array(ProductComponentInputSchema).min(1).max(PRODUCT_COMPONENTS_MAX).optional(),
  rules: z.array(ProductRuleInputSchema).max(PRODUCT_RULES_MAX).optional(),
  main_supplier: z
    .strictObject({
      name: z.string().trim().min(1).max(300),
      tax_id: z.string().trim().max(30).nullish(),
    })
    .nullish(),
  from_contract_id: z.uuid().nullish(),
});
export type ProductCreate = z.infer<typeof ProductCreateSchema>;

/** gap-d1 #18 · "Nhập lô" tay: nhập kho một lô (qua cùng đường `applyDelivery`: BQ + FIFO giữ nguyên). `component_id` bỏ trống = thành
 *  phần chính (đầu tiên có kho). SL = chuỗi thập phân ≤ 4 số lẻ; `unit_price` = đồng/đơn vị chưa VAT; gói suất cần `expires_on`. */
export const ProductLotCreateSchema = z.strictObject({
  component_id: z.uuid().nullish(),
  qty: z
    .string()
    .trim()
    .regex(/^\d{1,14}(\.\d{1,4})?$/),
  unit_price: z.number().int().min(0).max(1_000_000_000_000),
  received_on: z.iso.date().nullish(),
  expires_on: z.iso.date().nullish(),
  supplier: z
    .strictObject({
      name: z.string().trim().min(1).max(300),
      tax_id: z.string().trim().max(30).nullish(),
    })
    .nullish(),
});
export type ProductLotCreate = z.infer<typeof ProductLotCreateSchema>;
/** Kho + giá vốn BQ của thành phần trước → sau khi nhập lô (BA 5.7d). */
export type ProductLotResultOut = {
  component_id: string;
  on_hand_before: string;
  on_hand_after: string;
  avg_cost_before: number;
  avg_cost_after: number;
};

export const ProductRuleCreateSchema = z.strictObject({
  pattern,
  component_id: z.uuid().nullish(),
});
export type ProductRuleCreate = z.infer<typeof ProductRuleCreateSchema>;

/** Gợi ý SP cho một dòng HĐ (BA 5.5b): quy tắc nhận diện ⇒ trùng từ ⇒ Tạo mới. HĐ Giới thiệu chỉ gợi ý SP nhóm Giới thiệu. */
export const ProductMatchSchema = z.strictObject({
  text: z.string().trim().min(1).max(500),
  deal: z.enum(["buy", "sell", "referral"]).nullish(),
});
export type ProductMatch = z.infer<typeof ProductMatchSchema>;

const pageText = z
  .string()
  .regex(/^\d{1,4}$/)
  .transform(Number)
  .pipe(z.number().int().min(1).max(PRODUCTS_PAGE_MAX));
export const ProductsQuerySchema = z.strictObject({
  group: z.enum(PRODUCT_GROUPS).optional(),
  q: z.string().max(100).optional(),
  limit: pageText.optional(),
});
export type ProductsQuery = z.infer<typeof ProductsQuerySchema>;

export type ProductComponentOut = {
  id: string;
  ord: number;
  name: string;
  unit: string | null;
  mode: ComponentMode;
  on_hand: string;
  avg_cost: number;
  stock_value: number;
};
export type ProductRuleOut = { id: string; pattern: string; component_id: string | null };
export type ProductOut = {
  id: string;
  name: string;
  unit: string | null;
  spec: string | null;
  group: ProductGroup;
  main_supplier: { party_key: string; name: string | null } | null;
  created_from_contract_id: string | null;
  components: ProductComponentOut[];
  rules: ProductRuleOut[];
};
export type ProductLotOut = {
  id: string;
  component_id: string;
  qty: string;
  remaining: string;
  received_on: string;
  expires_on: string | null;
};
/** Dòng sổ nhập/xuất — chỉ dòng người dùng thấy (luật thấy HĐ M1). */
export type StockMoveOut = {
  id: string;
  component_id: string;
  direction: "in" | "out";
  reason: "delivery" | "expire" | "reversal" | "manual";
  qty: string;
  unit_cost: number;
  amount: number;
  on_hand_after: string | null;
  avg_after: number | null;
  moved_on: string;
  contract_id: string | null;
};
export type ProductDetailOut = ProductOut & { lots: ProductLotOut[]; moves: StockMoveOut[] };
export type ProductMatchOut = {
  suggestions: {
    product: ProductOut;
    component_id: string | null;
    by: "rule" | "words";
    score: number;
  }[];
  /** Không khớp ⇒ đề xuất tạo SP mới từ tên dòng. */
  create: { name: string } | null;
};
