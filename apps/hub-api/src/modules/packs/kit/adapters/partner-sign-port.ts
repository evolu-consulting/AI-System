// CR-182 · sổ cổng «Đối tác ký qua link»: gói Hợp đồng đăng ký lúc mount (`partnerSignPort`), hub gắn transport email (`partnerSignMailer`).
import type {
  PartnerSignMailer,
  PartnerSignMailerRegistry,
  PartnerSignPortRegistry,
  PartnerSignPublicPort,
} from "../application/partner-sign.ports";

export function createPartnerSignPortRegistry(): PartnerSignPortRegistry {
  let port: PartnerSignPublicPort | undefined;
  return {
    set: (p) => {
      port = p;
    },
    get: () => port,
  };
}
export function createPartnerSignMailerRegistry(): PartnerSignMailerRegistry {
  let m: PartnerSignMailer | null = null;
  let base = "http://localhost:3300";
  return {
    set: (x, baseUrl) => {
      m = x;
      if (baseUrl) base = baseUrl;
    },
    get: () => m,
    baseUrl: () => base,
  };
}
export const partnerSignPort = createPartnerSignPortRegistry();
export const partnerSignMailer = createPartnerSignMailerRegistry();
