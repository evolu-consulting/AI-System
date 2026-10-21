// GAP-D2 · #23: luật thuần của hộp "Thêm công ty" — MST hợp lệ (10 số, 13 số chi nhánh, 12 số cá nhân; cho phép gạch/cách/chấm) và
// mã lỗi `/companies` ⇒ khoá câu báo. Máy chủ chuẩn hoá lại; đây chỉ để chặn gửi rỗng/sai dạng.
export const normalizeTax = (raw: string): string | null => {
  const s = raw.replace(/[\s.]/g, "");
  if (s.includes("-") && !/^\d{10}-\d{3}$/.test(s)) return null;
  const d = s.replace("-", "");
  if (!/^\d+$/.test(d)) return null;
  if (d.length === 13) return `${d.slice(0, 10)}-${d.slice(10)}`;
  return d.length === 10 || d.length === 12 ? d : null;
};

export type CompanyErr = "exists" | "invalid" | "unavailable" | "failed";
export const companyErrKey = (code: string): CompanyErr =>
  code === "COMPANY_EXISTS"
    ? "exists"
    : code === "COMPANY_INVALID"
      ? "invalid"
      : code === "TAX_UNAVAILABLE"
        ? "unavailable"
        : "failed";
