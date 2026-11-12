// CR-139c · dữ liệu + luật thuần của `bun run demo:org` (công ty mẫu `demo` có cấu trúc doanh nghiệp thật). KHÔNG I/O.
// Phòng ban/trưởng phòng/thành viên: NGUỒN DUY NHẤT là `deploy/tenants/demo.yaml` (người ở đây chỉ khai tên, vai gói, nhóm vai).
import {
  memberPairs,
  type OnboardSpec,
} from "../../../apps/admin-api/src/modules/tenant-onboard/domain/onboard.rules";

export const DEMO_TENANT_KEY = "demo";
export const EMAIL_DOMAIN = "example.invalid";
export type PackRole = "owner" | "editor" | "viewer";
export type Person = {
  username: string;
  name: string;
  /** Vai trong Sổ Hợp Tác: owner = Toàn quyền, editor = Nhân viên (sửa), viewer = Chỉ xem. */
  pack: PackRole;
  /** Nhóm vai KHÔNG suy được từ phòng ban (xem `ROLE_GROUPS`). */
  roles?: readonly string[];
};

export const DEMO_PEOPLE: readonly Person[] = [
  { username: "demo-owner", name: "Nguyễn Văn An", pack: "owner", roles: ["nguoi-ky-hd"] }, // Giám đốc
  { username: "binh.tran", name: "Trần Thị Bình", pack: "editor" }, // TP Kinh doanh
  { username: "cuong.le", name: "Lê Minh Cường", pack: "editor" },
  { username: "dung.pham", name: "Phạm Thu Dung", pack: "editor" },
  { username: "demo-editor", name: "Hồ Minh Quân", pack: "editor" }, // NV Kinh doanh (tương thích e2e/UAT cũ)
  { username: "phuc.do", name: "Đỗ Quang Phúc", pack: "editor" }, // TP Mua hàng
  { username: "tung.mai", name: "Mai Văn Tùng", pack: "editor" },
  { username: "em.hoang", name: "Hoàng Văn Em", pack: "editor", roles: ["nguoi-ky-hd"] }, // Kế toán trưởng
  { username: "giang.vu", name: "Vũ Thị Giang", pack: "editor", roles: ["tai-chinh"] }, // KT quản trị
  { username: "ha.ly", name: "Lý Thu Hà", pack: "editor", roles: ["ke-toan-thanh-toan"] }, // KT thanh toán / mua hàng
  { username: "hung.dinh", name: "Đinh Văn Hùng", pack: "viewer", roles: ["thu-quy"] }, // Thủ quỹ
  { username: "demo-viewer", name: "Phan Thị Yến", pack: "editor" }, // NV Kế toán (tương thích e2e/UAT cũ)
  { username: "huy.dang", name: "Đặng Quốc Huy", pack: "editor" }, // TP Pháp chế
  { username: "khoa.bui", name: "Bùi Văn Khoa", pack: "editor" }, // Quản lý kho
  { username: "lan.ngo", name: "Ngô Thị Lan", pack: "editor" },
];

/** Nhóm vai (không phải phòng ban) mà quy trình cần — thành viên khai ở `Person.roles`. Mã `nguoi-ky-hd`/`tai-chinh`/`thu-quy` do seed hub tạo. */
export const ROLE_GROUPS: readonly { key: string; vi: string }[] = [
  { key: "nguoi-ky-hd", vi: "Người ký HĐ" },
  { key: "tai-chinh", vi: "Tài chính" },
  { key: "thu-quy", vi: "Thủ quỹ" },
  { key: "ke-toan-thanh-toan", vi: "Kế toán thanh toán / mua hàng" },
];
export const PACK_GROUP: Record<PackRole, string> = {
  owner: "contracts-owner",
  editor: "contracts-editor",
  viewer: "contracts-viewer",
};

export const emailOf = (username: string): string => `${username}@${EMAIL_DOMAIN}`;
export const usernameOf = (email: string): string => email.replace(/@[^@]*$/, "");

/** Nhóm cần có thành viên đúng bằng `want` (chỉ xét người trong danh sách quản lý: không đụng người ngoài). */
export type GroupPlan = { key: string; want: ReadonlySet<string> };

/** Phòng ban (từ file khai báo) + nhóm gói + nhóm vai ⇒ danh sách nhóm và thành viên mong muốn. THUẦN. */
export function planGroups(
  spec: OnboardSpec,
  people: readonly Person[] = DEMO_PEOPLE,
): GroupPlan[] {
  const by = new Map<string, Set<string>>();
  const add = (key: string, u: string) => by.set(key, (by.get(key) ?? new Set()).add(u));
  const managed = new Set(people.map((p) => p.username));
  for (const m of memberPairs(spec).members) {
    const u = usernameOf(m.email);
    if (managed.has(u)) add(m.key, u);
  }
  for (const g of [...Object.values(PACK_GROUP), ...ROLE_GROUPS.map((r) => r.key)])
    by.set(g, by.get(g) ?? new Set());
  for (const p of people) {
    add(PACK_GROUP[p.pack], p.username);
    for (const r of p.roles ?? []) add(r, p.username);
  }
  return [...by].map(([key, want]) => ({ key, want }));
}

/** Chênh lệch thành viên hiện tại → mong muốn, chỉ bớt người trong tập `managed`. THUẦN. */
export function diffMembers(
  cur: ReadonlySet<string>,
  want: ReadonlySet<string>,
  managed: ReadonlySet<string>,
): { add: string[]; remove: string[] } {
  return {
    add: [...want].filter((u) => !cur.has(u)),
    remove: [...cur].filter((u) => managed.has(u) && !want.has(u)),
  };
}

/** HĐ mẫu: người gửi (đúng đường API) + người DUYỆT bước đầu mong đợi (kiểm cuối script). */
export type Sample = {
  n: number;
  by: string;
  title: string;
  value: number;
  direction: "sale" | "purchase";
  firstApprover: string;
};
export const SAMPLES: readonly Sample[] = [
  {
    n: 1,
    by: "cuong.le",
    title: "[Demo] HĐ dịch vụ chữ ký số · Kinh doanh gửi",
    value: 300_000_000,
    direction: "sale",
    firstApprover: "binh.tran",
  },
  {
    n: 2,
    by: "giang.vu",
    title: "[Demo] HĐ mua thiết bị văn phòng · Kế toán gửi",
    value: 800_000_000,
    direction: "purchase",
    firstApprover: "em.hoang",
  },
  {
    n: 3,
    by: "tung.mai",
    title: "[Demo] HĐ mua nguyên vật liệu · Mua hàng gửi",
    value: 120_000_000,
    direction: "purchase",
    firstApprover: "phuc.do",
  },
  {
    n: 4,
    by: "binh.tran",
    title: "[Demo] HĐ bán lô thiết bị · Trưởng phòng Kinh doanh tự gửi",
    value: 150_000_000,
    direction: "sale",
    firstApprover: "demo-owner",
  },
];
export const sampleId = (n: number): string => `c139c000-0000-4000-8000-00000000000${n}`;
