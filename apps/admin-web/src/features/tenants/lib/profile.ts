// niti-onboard · hồ sơ công ty ⇒ các dòng (khoá nhãn i18n `tenants.profile.*`, giá trị) có giá trị, thứ tự cố định. Thuần.
import type { TenantDetail } from "@ai/contracts";

type Profile = NonNullable<TenantDetail["profile"]>;
export type ProfileKey =
  | "legalName"
  | "address"
  | "taxId"
  | "email"
  | "websites"
  | "zalo"
  | "phones";

export function profileLines(p: Profile | undefined): [ProfileKey, string][] {
  if (!p) return [];
  const lines: [ProfileKey, string | undefined][] = [
    ["legalName", p.legal_name],
    ["address", p.address],
    ["taxId", p.tax_id],
    ["email", p.email],
    ["websites", p.websites?.join(" · ")],
    ["zalo", p.zalo_oa],
    ["phones", p.phones?.map((x) => `${x.label}: ${x.number}`).join(" · ")],
  ];
  return lines.filter((l): l is [ProfileKey, string] => !!l[1]);
}
