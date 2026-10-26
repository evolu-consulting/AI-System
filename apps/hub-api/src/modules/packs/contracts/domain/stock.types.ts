// V2-B · kiểu của kho lô + giá vốn BQ (`stock.rules.ts`, `adapters/stock.repo.ts::applyDelivery`). SL = chuỗi thập phân ≤ 4 số lẻ
// ("150", "2.5"); tiền = số nguyên đồng (≤ 10¹⁵, an toàn trong number).

/** stock = kho lô · quota = gói suất có hạn · order = không giữ hàng (giá vốn theo đơn) · none = Giới thiệu. */
export type StockMode = "stock" | "quota" | "order" | "none";

/** Một dòng nhập/xuất do V2-D sinh từ mốc giao (mỗi dòng = một thành phần). */
export type DeliveryMove = {
  componentId: string;
  direction: "in" | "out";
  qty: string;
  /** Nhập: giá lô (đồng/đơn vị, chưa VAT). Thành phần `order`: giá vốn của đơn (cả nhập lẫn xuất). Xuất kho/gói: bỏ trống (BQ). */
  unitPrice?: number | null;
  contractId?: string | null;
  milestoneId?: string | null;
  contractItemId?: string | null;
  supplierPartyKey?: string | null;
  /** gap-d1: `manual` = nhập lô tay (không HĐ); vắng ⇒ `delivery`. */
  reason?: "delivery" | "manual";
  /** Nhập gói suất: hạn gói = ngày kết thúc HĐ mua (bắt buộc với `quota`). */
  expiresOn?: string | null;
};

export type DeliveryCtx = {
  tenantId: string;
  on: string;
  /** Ép cho phép/cấm giao vượt tồn; vắng ⇒ đọc cài đặt tenant khi thiếu kho (cùng tx). */
  allowNegative?: boolean;
};

export type PlannedMove = {
  id: string;
  componentId: string;
  lotId: string | null;
  direction: "in" | "out";
  reason: "delivery" | "expire" | "reversal" | "manual";
  qty: string;
  unitCost: number;
  amount: number;
  onHandBefore: string | null;
  onHandAfter: string | null;
  valueBefore: number | null;
  valueAfter: number | null;
  avgBefore: number | null;
  avgAfter: number | null;
  contractId: string | null;
  milestoneId: string | null;
  contractItemId: string | null;
  supplierPartyKey: string | null;
  /** V2-M: id dòng sổ bị đảo (chỉ `reason = "reversal"`). */
  reverses?: string | null;
  /** delivery-opts: SL phần giao vượt tồn (tồn đi âm); vắng = không vượt. */
  overdrawn?: string | null;
};

/** Kho trước → sau, giá vốn trước → sau của một thành phần (BA 5.7d). */
export type ComponentChange = {
  componentId: string;
  productId: string;
  mode: StockMode;
  onHandBefore: string;
  onHandAfter: string;
  valueBefore: number;
  valueAfter: number;
  avgCostBefore: number;
  avgCostAfter: number;
};

export type DeliveryResult = {
  components: ComponentChange[];
  moves: PlannedMove[];
  /** Thành phần giao vượt tồn (chỉ khi cài đặt cho phép); trống = không vượt. */
  overdrawn?: StockShortage[];
};

export type StockShortage = { componentId: string; need: string; have: string };
