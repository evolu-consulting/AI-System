// CR-124 · q3 · sổ MỘT cổng hộp thư liên công ty (gói Hợp đồng đăng ký lúc mount; bộ chuyển đọc mỗi lượt). Đăng ký lại ⇒ thay.
import type {
  PartnerMailboxPort,
  PartnerMailboxPortRegistry,
} from "../application/partner-mailbox.ports";

export function createPartnerMailboxPortRegistry(): PartnerMailboxPortRegistry {
  let port: PartnerMailboxPort | undefined;
  return {
    set: (p) => {
      port = p;
    },
    get: () => port,
  };
}

export const partnerMailboxPort = createPartnerMailboxPortRegistry();
