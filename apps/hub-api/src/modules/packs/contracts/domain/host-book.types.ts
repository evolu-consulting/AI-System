// com-c8-host-read · ADR-0031: kiểu dữ liệu thuần của sổ giá/tồn đọc từ gói khác (tách khỏi `application/host-book.ports.ts` để lớp domain dùng).
import type { HostHint, HostMatchHow } from "./host-book.rules";

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
