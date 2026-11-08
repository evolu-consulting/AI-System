// CR-125 · thử nghiệm quy trình MUA HÀNG 11 bước: dữ liệu hư cấu dùng chung (công ty, nhóm, người) cho `purchase-flow.ts`.
// Chỉ dữ liệu giả; email @demo.local; mật khẩu dev dùng chung (không phải secret).

export const TENANT = { key: "muahang", name: "Công ty Demo Mua Hàng" } as const;
export const DEMO_PW = "1234567890";
export const ADMIN_USER = "quantri";

export type Role = {
  group: string; // mã nhóm
  groupName: string;
  user: string; // username
  display: string;
};

/** Mỗi vai = một nhóm + một người (Giám đốc có thêm người được ủy quyền cùng nhóm). */
export const ROLES = {
  nv: {
    group: "nhan-vien-phong-ban",
    groupName: "Nhân viên phòng ban",
    user: "an.nv",
    display: "Lê Minh An",
  },
  tbp: {
    group: "truong-bo-phan",
    groupName: "Trưởng bộ phận",
    user: "binh.tbp",
    display: "Trần Quốc Bình",
  },
  mh: { group: "mua-hang", groupName: "Mua hàng", user: "cuong.mh", display: "Phạm Hữu Cường" },
  tmh: {
    group: "truong-mua-hang",
    groupName: "Trưởng mua hàng",
    user: "dung.tmh",
    display: "Võ Thị Dung",
  },
  tc: { group: "tai-chinh", groupName: "Tài chính", user: "em.tc", display: "Đặng Văn Em" },
  gd: { group: "giam-doc", groupName: "Giám đốc", user: "giang.gd", display: "Hoàng Thu Giang" },
  uq: {
    group: "giam-doc",
    groupName: "Giám đốc",
    user: "hai.uq",
    display: "Bùi Văn Hải (được ủy quyền)",
  },
  pc: { group: "phap-che", groupName: "Pháp chế", user: "kim.pc", display: "Ngô Thị Kim" },
  kt: { group: "ke-toan", groupName: "Kế toán", user: "lan.kt", display: "Đinh Thị Lan" },
  ktt: {
    group: "ke-toan-truong",
    groupName: "Kế toán trưởng",
    user: "minh.ktt",
    display: "Phan Văn Minh",
  },
  kho: { group: "kho", groupName: "Kho", user: "nam.kho", display: "Lý Văn Nam" },
  tq: { group: "thu-quy", groupName: "Thủ quỹ", user: "oanh.tq", display: "Trương Thị Oanh" },
} as const satisfies Record<string, Role>;

export type RoleKey = keyof typeof ROLES;
export const email = (user: string): string => `${user}@demo.local`;
