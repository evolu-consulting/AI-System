// CR-121 c11b · tiêu đề một lượt ở khối "Đang chạy": có nhãn nghiệp vụ của bản ghi (`record_label`, vd "HĐ HD-Q1-001 · Thuê kho")
// ⇒ nhãn là dòng chính, "tên việc · bắt đầu giờ" xuống dòng phụ; chưa có nhãn ⇒ chỉ "tên việc · bắt đầu giờ" (không lộ id thô).
type T = (key: string, o: { job: string; at: string }) => string;

export type RunTitle = { primary: string; secondary: string | null };

export function runTitle(
  t: T,
  r: { record_label?: string | null },
  job: string,
  at: string,
): RunTitle {
  const base = t("tenants.flows.runTitle", { job, at });
  const label = r.record_label?.trim();
  return label ? { primary: label, secondary: base } : { primary: base, secondary: null };
}
