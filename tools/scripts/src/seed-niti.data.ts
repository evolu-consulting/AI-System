// tool-seed-niti · khai báo dữ liệu khách hàng NiTi Group (tenant thật) cho `seed-niti.ts`. Tách khỏi logic để test chạy bằng
// `SeedSpec` giả (KHÔNG dùng dữ liệu NiTi trong test). Không chứa bí mật; email là `<username>@<emailDomain>` (đổi bằng --email-domain).

export type Dept = { key: string; vi: string; en: string };
export type Person = {
  username: string;
  display: string;
  /** Chức danh (chỉ để báo cáo kế hoạch). */
  title: string;
  /** Khoá phòng ban (= Dept.key). */
  dept: string;
  head: boolean;
  /** tenant_admin ⇒ app Admin + owner các gói; member ⇒ vai theo `packRole`. */
  role: "tenant_admin" | "member";
  /** Vai gói contracts: owner = Toàn quyền, editor = Nhân viên (đọc+ghi, duyệt qua cổng trưởng phòng). */
  packRole: "owner" | "editor";
};
export type SeedSpec = {
  tenantKey: string;
  tenantName: string;
  timezone: string;
  emailDomain: string;
  /** Gói bật cho tenant (Sổ Hợp Tác + Community); app Admin đi theo vai tenant_admin. */
  packs: string[];
  root: Dept;
  departments: Dept[];
  people: Person[];
};

const BGD = { key: "pb-giam-doc", vi: "Ban Giám đốc", en: "Board of Directors" };
const KD = { key: "pb-kinh-doanh", vi: "Phòng Kinh doanh", en: "Sales" };
const KT = { key: "pb-ke-toan", vi: "Phòng Kế toán", en: "Accounting" };

export const NITI_SPEC: SeedSpec = {
  tenantKey: "nitigroup",
  tenantName: "NiTi Group",
  timezone: "Asia/Ho_Chi_Minh",
  emailDomain: "nitigroup.example.invalid",
  packs: ["contracts"], // ADR-0044: Bảng tin = add-on `contracts-community`, admin nền tảng bật riêng
  root: BGD,
  departments: [KD, KT],
  people: [
    {
      username: "tien",
      display: "Tiên",
      title: "Giám đốc",
      dept: BGD.key,
      head: true,
      role: "tenant_admin",
      packRole: "owner",
    },
    {
      username: "thong",
      display: "Thông",
      title: "Phó giám đốc",
      dept: BGD.key,
      head: false,
      role: "member",
      packRole: "editor",
    },
    {
      username: "chieu",
      display: "Chiêu",
      title: "Trưởng phòng Kinh doanh",
      dept: KD.key,
      head: true,
      role: "member",
      packRole: "editor",
    },
    {
      username: "kim",
      display: "Kim",
      title: "Nhân viên Kinh doanh",
      dept: KD.key,
      head: false,
      role: "member",
      packRole: "editor",
    },
    {
      username: "ha",
      display: "Hà",
      title: "Trưởng phòng Kế toán",
      dept: KT.key,
      head: true,
      role: "member",
      packRole: "editor",
    },
  ],
};
