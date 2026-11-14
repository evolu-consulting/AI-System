// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-161 · fixture hai công ty cho hành trình «kết nối không cần hợp đồng» (phần thuần: tên, người, MST; spec + stack cùng dùng).
// Công ty do `e2e/_kit/two-companies.seed.ts` dựng (không đổi seed chung): cả hai bật Sổ Hợp Tác + add-on contracts-community + Danh bạ, có tên pháp lý + MST giả.
// NitiGroup-test: Tiên + Thanh (cùng Toàn quyền), Vy (nhân viên). Preschool-test: Dung (Toàn quyền). Mật khẩu = JA_USER_PW (stack journey).

const sfx = (): string => process.env.JA_D5_SUFFIX ?? "x";

/** Khoá công ty (`e2e-…` bắt buộc) + tên pháp lý + MST giả. */
export const CO = {
  a: { key: () => `e2e-niti161-${sfx()}`, name: "NitiGroup-test", tax: "0100161001" },
  b: { key: () => `e2e-pre161-${sfx()}`, name: "Preschool-test", tax: "0100161002" },
} as const;

/** Tên đăng nhập (người trong truyện → tài khoản). Tiên/Dung = «Giám đốc» (Toàn quyền) của công ty mình. */
export const WHO = {
  tien: "e2e-giamdoc",
  thanh: "e2e-thanh",
  vy: "e2e-kd-nv",
  dung: "e2e-giamdoc",
} as const;

export const POST_BODY = "Bản tin NitiGroup: khai trương chi nhánh mới";
