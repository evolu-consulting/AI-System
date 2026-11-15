// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-165 · (phần TĨNH, không import bun-only — Playwright nạp spec bằng CJS) fixture 3 công ty cho e2e «quy trình thật»: cây phòng ban = `deploy/tenants/<key>.yaml` (đọc bằng `readOrg`, không khai lại) + vài nhân viên thêm
// (yaml không có nhân viên dưới trưởng phòng). Người ở yaml → tài khoản = phần trước «@», dấu chấm đổi «-». Spec + stack cùng dùng (thuần, không I/O ngoài đọc yaml).

export type Side = "n" | "e" | "p";
export type TenantKey = "nitigroup" | "evolu" | "preschool";
const sfx = (): string => process.env.JA_D5_SUFFIX ?? "x";

/** n = NitiGroup (phòng Kinh doanh KHÔNG trưởng) · e = Evolu (Julian trưởng Kinh doanh, người phụ trách nhận HĐ) · p = Preschool (một người). */
export const CO = {
  n: { yaml: "nitigroup", key: () => `e2e-fl3n-${sfx()}`, name: "Niti-flows", tax: "0100165001" },
  e: { yaml: "evolu", key: () => `e2e-fl3e-${sfx()}`, name: "Evolu-flows", tax: "0100165002" },
  p: {
    yaml: "preschool",
    key: () => `e2e-fl3p-${sfx()}`,
    name: "Preschool-flows",
    tax: "0100165003",
  },
} as const satisfies Record<
  Side,
  { yaml: TenantKey; key: () => string; name: string; tax: string }
>;

export const userOf = (email: string): string => (email.split("@")[0] ?? "").replaceAll(".", "-");

/** Người trong truyện → tài khoản. */
export const WHO = {
  n: {
    giamdoc: userOf("thuytien.le@nitigroupvn.com"),
    phogd: userOf("thuyngan.le@nitigroupvn.com"),
    kdNv: userOf("thuyvy.trang@nitigroupvn.com"), // phòng Kinh doanh KHÔNG có trưởng
    ktTruong: userOf("thuphuong.pham@nitigroupvn.com"),
    ktNv: userOf("hoa.tran@nitigroupvn.com"),
    ktNv2: userOf("lan.vo@nitigroupvn.com"),
  },
  e: {
    giamdoc: userOf("thomas.tran@evolu.com"),
    kdTruong: userOf("julian.bui@evolu.com"), // người phụ trách «Nhận hợp đồng từ đối tác»
    kdNv: userOf("minh.le@evolu.com"),
  },
  p: { giamdoc: userOf("dung.dang@preschool.com") },
} as const;
