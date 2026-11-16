// CR-180: các mục dòng thông tin đầu trang HĐ (MetaList). Hàm thuần để test: mục rỗng bị MetaList bỏ; nhãn không mang dấu «:» đuôi
// (điện thoại tự thêm «:»).
export const bareLabel = (s: string): string => s.replace(/[:：]\s*$/, "");

/** Có hiện mục «File ký / Tệp» không: HĐ có chứng từ (trừ HĐ nguyên tắc) hoặc đã có tệp gốc. */
export const showFileItem = (docType: string | undefined, hasDoc: boolean, hasFile: boolean) =>
  (hasDoc && docType !== "framework") || hasFile;
