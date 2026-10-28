// com-c8-host-read · ADR-0031: cổng ĐỌC `HostBookReader` (gói community khai cùng hình dạng ở `application/*.ports.ts` của nó; contracts
// cung cấp; `packs.mount.ts` tiêm sau — CHƯA nối Community). Kiểu thuần tự khai, không kiểu của gói kia. Chỉ đọc.
import type { PackWho } from "../../kit/application/ports";
import type { HostHint, HostMatchHow } from "../domain/host-book.rules";

/** Người gọi. `kind` do C1 thêm vào `PackWho`; vắng ⇒ coi là nội bộ (token người dùng), `external` ⇒ từ chối. */
export type HostCaller = PackWho & { kind?: "internal" | "external" };

export type HostPriceOut = {
  supplierName: string;
  supplierPartyKey: string | null;
  price: number;
  unit: string | null;
  source: string;
  seenOn: string;
  /** null = chưa rõ. */
  vatIncluded: boolean | null;
  /** null = không hạn. */
  expiresOn: string | null;
};
export type HostProductOut = {
  /** Vị trí gợi ý trong lô vào. */
  index: number;
  hint: HostHint;
  match: { id: string; name: string; unit: string | null; how: HostMatchHow } | null;
  /** null ⇒ SP không theo dõi kho. */
  onHand: string | null;
  avgCost: number | null;
  prices: HostPriceOut[];
};
export type HostPartnerRep = {
  partyKey: string;
  band: "good" | "fair" | "watch" | "new" | null;
  score: number | null;
};
export type HostBookOut = { products: HostProductOut[]; partners: HostPartnerRep[] };

export type HostBookReader = {
  read(
    who: HostCaller,
    q: { hints: readonly HostHint[]; partyKeys?: readonly string[] },
  ): Promise<HostBookOut>;
  /** User nội bộ có quyền đọc gói khi tenant có hàng (tồn > 0) khớp tên `product`. MỘT tx sổ + MỘT câu quyền theo tập. */
  stockHolders(tenantId: string, product: string): Promise<readonly string[]>;
};

export class HostBookError extends Error {
  constructor(readonly kind: "forbidden" | "too_many" | "invalid") {
    super(kind);
  }
}

/** Repo trong tx người gọi (RLS tenant + luật thấy M1). */
export type HostBookRepo = {
  candidates(
    hints: readonly HostHint[],
  ): Promise<Map<number, { id: string; name: string; nameKey: string; unit: string | null }[]>>;
  /** `today` = ngày hiện tại theo múi giờ tenant (YYYY-MM-DD) — giá hết hạn tính theo đó, không theo `current_date` của DB. */
  book(
    productIds: readonly string[],
    today: string,
  ): Promise<
    Map<string, { onHand: string | null; avgCost: number | null; prices: HostPriceOut[] }>
  >;
};
