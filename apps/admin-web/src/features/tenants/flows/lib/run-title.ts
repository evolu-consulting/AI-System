// CR-121 c11b · tiêu đề một lượt ở khối "Đang chạy": có nhãn nghiệp vụ của bản ghi (`record_label`, vd "HĐ HD-Q1-001 · Thuê kho")
// ⇒ nhãn là dòng chính, "tên việc · bắt đầu giờ" xuống dòng phụ; chưa có nhãn ⇒ chỉ "tên việc · bắt đầu giờ" (không lộ id thô).
import { recordLabel, type WithRecordLabel } from "../../../processes/lib/run-label";

type T = (key: string, o: { job: string; at: string }) => string;

export type RunTitle = { primary: string; secondary: string | null };

export function runTitle(t: T, r: WithRecordLabel, job: string, at: string): RunTitle {
  const base = t("tenants.flows.runTitle", { job, at });
  const label = recordLabel(r);
  return label ? { primary: label, secondary: base } : { primary: base, secondary: null };
}
