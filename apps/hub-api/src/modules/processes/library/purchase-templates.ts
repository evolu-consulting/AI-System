// CR-125 · cr125-purchase-templates · 3 mẫu Thư viện «Quy trình mua hàng» (Phần 1 Đề xuất → Đặt hàng, Phần 2 Hợp đồng, Phần 3 Nhận hàng →
// Thanh toán). NGUỒN: dựng bằng giao diện quản trị nền tảng (`tools/demo/purchase-templates.ts build`) rồi `export` ra
// `purchase-templates.data.ts`; ở đây chỉ gán id cố định để seed idempotent. Nhóm duyệt/làm theo MÃ (`group_key`): công ty sao chép thì
// mã → nhóm của chính công ty (`mapGroupKey`); mã nhóm khớp `TEMPLATE_GROUPS` của fixture seed (công ty demo đủ nhóm ⇒ `templateReadiness` xanh).
import { PURCHASE_TEMPLATES_JSON } from "./purchase-templates.data";

export type PurchaseTemplate = {
  id: string;
  key: string;
  name: string;
  description: string;
  input_hint: string;
  inputs: unknown;
  trigger: { event: string };
  app: string;
  stages: unknown[];
};

/** Id cố định theo thứ tự Phần 1..3. */
export const PURCHASE_TEMPLATE_IDS = [
  "0c125000-0000-4000-8000-0000000000d1",
  "0c125000-0000-4000-8000-0000000000d2",
  "0c125000-0000-4000-8000-0000000000d3",
] as const;

export const PURCHASE_TEMPLATES: readonly PurchaseTemplate[] = (
  JSON.parse(PURCHASE_TEMPLATES_JSON) as Omit<PurchaseTemplate, "id">[]
).map((t, i) => ({ ...t, id: PURCHASE_TEMPLATE_IDS[i] as string }));
