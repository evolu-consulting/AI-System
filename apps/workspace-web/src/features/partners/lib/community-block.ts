// CR-130 · khối «Bảng tin» trên chi tiết đối tác SHT (thuần): nhóm hàng nhập tay, mã lỗi → câu hướng dẫn, link tạo tài khoản ở Admin.
export const CATS_MAX = 50;
export const CAT_LEN = 80;
export const AREA_MAX = 100;

/** «Chữ ký số, Đóng gói» → ["Chữ ký số","Đóng gói"]: tách theo dấu phẩy/xuống dòng, bỏ rỗng + trùng, cắt theo giới hạn hợp đồng. */
export function parseCats(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[,\n;]/)) {
    const c = raw.trim().slice(0, CAT_LEN);
    if (c && !out.includes(c)) out.push(c);
  }
  return out.slice(0, CATS_MAX);
}

export const catsText = (cats: readonly string[]): string => cats.join(", ");

/** Mã lỗi API khi mời/gỡ/lưu → khoá i18n câu nói cách sửa (mã lạ ⇒ câu chung). */
export function communityErrorKey(code: string): string {
  switch (code) {
    case "PARTNER_ACCOUNT_TAKEN":
      return "contracts.pcm.errTaken";
    case "VALIDATION":
    case "INVALID":
      return "contracts.pcm.errUnknownAccount";
    default:
      return "contracts.pcm.errGeneric";
  }
}

/** Trang Admin (qua đăng nhập một lần) để tạo tài khoản công ty đối tác; tên điền sẵn qua `?name=`. */
export const adminPartnersNext = (name: string): string =>
  `/partners?name=${encodeURIComponent(name.slice(0, 200))}`;
