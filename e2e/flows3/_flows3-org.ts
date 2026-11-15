// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-165 · fixture 3 công ty cho e2e «quy trình thật»: cây phòng ban = `deploy/tenants/<key>.yaml` (đọc bằng `readOrg`, không khai lại) + vài nhân viên thêm
// (yaml không có nhân viên dưới trưởng phòng). Người ở yaml → tài khoản = phần trước «@», dấu chấm đổi «-». Spec + stack cùng dùng (thuần, không I/O ngoài đọc yaml).
import { readOrg } from "../../tools/scripts/src/tenant-flows.org";

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

/** Nhân viên thêm (email giả cùng dạng yaml): đứng dưới trưởng phòng để có «trưởng phòng duyệt». */
export const EXTRA: Record<TenantKey, { email: string; dept: string }[]> = {
  nitigroup: [
    { email: "hoa.tran@nitigroupvn.com", dept: "pb-ke-toan" },
    { email: "lan.vo@nitigroupvn.com", dept: "pb-ke-toan" },
  ],
  evolu: [{ email: "minh.le@evolu.com", dept: "pb-kinh-doanh" }],
  preschool: [],
};
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

export type SeedPerson = {
  username: string;
  display: string;
  title: string;
  dept: string;
  head: boolean;
  role: "tenant_admin" | "member";
  packRole: "owner" | "editor";
};

/** Người + phòng của một công ty (từ yaml + EXTRA). Trưởng phòng gốc = Toàn quyền + quản trị; còn lại nhân viên. */
export function seedPeople(side: Side): { root: string; depts: string[]; people: SeedPerson[] } {
  const y = CO[side].yaml;
  const org = readOrg(y);
  const people: SeedPerson[] = [];
  const add = (email: string, dept: string): void => {
    const top = email === org.rootHead;
    const u = userOf(email);
    people.push({
      username: u,
      display: u,
      title: u,
      dept,
      head: org.heads.get(dept) === email,
      role: top ? "tenant_admin" : "member",
      packRole: top ? "owner" : "editor",
    });
  };
  for (const [dept, emails] of org.members) for (const e of emails) add(e, dept);
  for (const x of EXTRA[y]) add(x.email, x.dept);
  return { root: org.rootKey, depts: org.deptKeys, people };
}
