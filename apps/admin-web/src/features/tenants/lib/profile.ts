// niti-onboard · kênh liên hệ KHÁC của công ty (website, Zalo, điện thoại phụ) ⇒ các dòng (khoá nhãn i18n `tenants.profile.*`, giá trị)
// có giá trị, thứ tự cố định. Thuần. CR-121: tên pháp lý/địa chỉ/MST/email/SĐT chính nay là cột nhập tay ở tab Hồ sơ (một nguồn),
// không đọc lại từ jsonb `profile` nữa.
import type { TenantDetail } from "@ai/contracts";

type Profile = NonNullable<TenantDetail["profile"]>;
export type ProfileKey = "websites" | "zalo" | "phones";

export function profileLines(p: Profile | undefined): [ProfileKey, string][] {
  if (!p) return [];
  const lines: [ProfileKey, string | undefined][] = [
    ["websites", p.websites?.join(" · ")],
    ["zalo", p.zalo_oa],
    ["phones", p.phones?.map((x) => `${x.label}: ${x.number}`).join(" · ")],
  ];
  return lines.filter((l): l is [ProfileKey, string] => !!l[1]);
}
