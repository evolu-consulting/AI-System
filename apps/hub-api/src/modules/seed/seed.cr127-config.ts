// CR-127 · Z0 · rule D7 · phần CR-127 của cấu hình công ty MỚI (tách khỏi seed.cr125-config.ts cho đủ ≤ 400 dòng; `writeCr125Config` gọi):
//   nhóm «Người ký HĐ» (`TEMPLATE_GROUPS`) = nhóm mẫu để chọn làm «Người ký phía công ty» trong bước Ký (CR-146b: không còn mặc định cấp công ty).
// Mẫu Thư viện của app Hợp đồng KHÔNG còn seed (người dùng chốt 2026-11-10 «chỉ cho tạo flow trống»; hub 0136 lưu trữ 11 mẫu).
// CHỈ công ty có tên trong `keys` (công ty mới / fixture). Idempotent, mỗi bước MỘT câu SQL theo tập.
/** Nhóm người ký phía công ty (seed demo): mã nhóm cố định, thành viên mẫu ở `seed.cr125-members`. */
export const SIGNER_GROUP_KEY = "nguoi-ky-hd";
export const SIGNER_GROUP = {
  key: SIGNER_GROUP_KEY,
  name: { vi: "Người ký HĐ", en: "Contract signers" },
} as const;
