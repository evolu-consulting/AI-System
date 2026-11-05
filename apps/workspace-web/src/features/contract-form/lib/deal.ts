// V2-F · HD-01 · BA §2/§3.1: loại hợp đồng Mua / Bán / Giới thiệu — nhãn đối tác + nhãn kho đi theo loại. Thuần.
import type { ContractDeal, ContractStage } from "@ai/contracts";
import type { TagTone } from "~/components/shared/tag";

export const DEALS: readonly ContractDeal[] = ["buy", "sell", "referral"] as const;

/** Vai của đối tác theo loại (BA 5.6): Mua ⇒ Nhà cung cấp; Bán ⇒ Khách hàng; Giới thiệu ⇒ Bên trả hoa hồng. */
export const PARTNER_ROLE: Record<ContractDeal, "supplier" | "customer" | "payer"> = {
  buy: "supplier",
  sell: "customer",
  referral: "payer",
};

/** Nhãn kho: Mua nhập, Bán xuất, Giới thiệu không ảnh hưởng kho (BA 5.7). */
export const STOCK_EFFECT: Record<ContractDeal, "in" | "out" | "none"> = {
  buy: "in",
  sell: "out",
  referral: "none",
};

/** Sắc thái nhãn giai đoạn (danh sách + dòng thời gian): chưa bắt đầu xám, đang thực hiện tím, đã xong xanh. */
export const STAGE_TONE: Record<ContractStage, TagTone> = {
  not_started: "grey",
  in_progress: "act",
  done: "ok",
};

/** Sắc thái nhãn loại HĐ: Mua tím, Bán xanh, Giới thiệu xám (mockup `CKIND`). */
export const DEAL_TONE: Record<ContractDeal, TagTone> = {
  buy: "act",
  sell: "ok",
  referral: "grey",
};

/** HĐ cũ (trước V2) chưa có `deal`: suy từ hướng (mua vào ⇒ Mua, còn lại ⇒ Bán). */
export function dealOf(c: { deal: ContractDeal | null; direction: string | null }): ContractDeal {
  return c.deal ?? (c.direction === "purchase" ? "buy" : "sell");
}

/** Đối tác nằm ở bên bán khi mình MUA; ở bên mua khi mình BÁN hoặc GIỚI THIỆU (V2-A). */
export const partnerIsSupplier = (d: ContractDeal): boolean => d === "buy";
