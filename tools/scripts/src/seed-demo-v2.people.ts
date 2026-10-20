// V2-O · việc ghi tay / sao / ghi chú / điểm đã chốt của đối tác mẫu (mockup PT). Khoá loại việc = `DEFAULT_JOB_TYPES` (rep-config.rules).
import type { Grp, PKey } from "./seed-demo-v2.specs";

export type Role = "supplier" | "customer" | "commission_payer";
export type JobSpec = {
  party: PKey;
  role: Role;
  grp: Grp;
  type: string;
  at: string;
  note: string;
  contract?: string;
  by: "owner" | "editor";
};
export const JOBS: readonly JobSpec[] = [
  {
    party: "ncca",
    role: "supplier",
    grp: "service",
    type: "incident_ok",
    at: "15/09/2024",
    note: "Cấp serial đợt 1 trong 1 ngày",
    contract: "c1",
    by: "owner",
  },
  {
    party: "ncca",
    role: "supplier",
    grp: "service",
    type: "quality_ok",
    at: "02/09/2024",
    note: "Lô 100 chữ ký đạt, không lỗi",
    contract: "c1",
    by: "owner",
  },
  {
    party: "ncca",
    role: "supplier",
    grp: "service",
    type: "price_raised",
    at: "01/09/2024",
    note: "Tăng giá gia hạn 4% so với năm trước",
    by: "owner",
  },
  {
    party: "viettel",
    role: "supplier",
    grp: "service",
    type: "incident_slow",
    at: "20/09/2024",
    note: "Lỗi phát hành hoá đơn, 5 ngày mới xử lý xong",
    contract: "c2",
    by: "editor",
  },
  {
    party: "viettel",
    role: "supplier",
    grp: "service",
    type: "quality_ok",
    at: "10/06/2024",
    note: "Kích hoạt gói 300 số đúng hẹn",
    contract: "c2",
    by: "editor",
  },
  {
    party: "viettel",
    role: "supplier",
    grp: "service",
    type: "price_kept",
    at: "01/06/2024",
    note: "Giữ đúng giá báo 320.000đ/gói",
    contract: "c2",
    by: "editor",
  },
  {
    party: "tanphat",
    role: "supplier",
    grp: "goods",
    type: "price_kept",
    at: "15/09/2024",
    note: "Giữ đúng giá báo 3.800đ/cuộn",
    by: "owner",
  },
  {
    party: "tanphat",
    role: "supplier",
    grp: "goods",
    type: "quality_ok",
    at: "16/09/2024",
    note: "Băng keo đạt chất lượng",
    contract: "c13",
    by: "owner",
  },
  {
    party: "tanphat",
    role: "supplier",
    grp: "goods",
    type: "reminded",
    at: "10/10/2024",
    note: "Phải nhắc giao thùng phi lô 1",
    contract: "c3",
    by: "owner",
  },
  {
    party: "tanphat",
    role: "customer",
    grp: "goods",
    type: "reminded",
    at: "17/10/2024",
    note: "Nhắc thanh toán, khách trả ngay hôm sau",
    contract: "c12",
    by: "owner",
  },
  {
    party: "abc",
    role: "customer",
    grp: "service",
    type: "reminded",
    at: "28/09/2024",
    note: "Nhắc gia hạn chữ ký số, khách hẹn lại",
    by: "editor",
  },
  {
    party: "hungthinh",
    role: "customer",
    grp: "service",
    type: "renewed_us",
    at: "30/09/2024",
    note: "Gia hạn 140 chữ ký số qua mình",
    contract: "c7",
    by: "editor",
  },
  {
    party: "anphu",
    role: "customer",
    grp: "service",
    type: "renewed_us",
    at: "21/09/2024",
    note: "Gia hạn 14 chữ ký số qua mình",
    contract: "c9",
    by: "editor",
  },
  {
    party: "minhphat",
    role: "customer",
    grp: "service",
    type: "reminded",
    at: "18/09/2024",
    note: "Hẹn lại thanh toán lần 2",
    by: "editor",
  },
  {
    party: "minhphat",
    role: "customer",
    grp: "service",
    type: "reminded",
    at: "25/09/2024",
    note: "Không phản hồi lần nhắc gia hạn thứ nhất",
    by: "editor",
  },
  {
    party: "minhphat",
    role: "customer",
    grp: "service",
    type: "reminded",
    at: "02/10/2024",
    note: "Không phản hồi lần nhắc gia hạn thứ hai",
    by: "editor",
  },
  {
    party: "pvi",
    role: "commission_payer",
    grp: "referral",
    type: "reconcile_missing",
    at: "25/09/2024",
    note: "Không gửi đối soát hoa hồng tháng 8",
    contract: "c14",
    by: "editor",
  },
  {
    party: "pvi",
    role: "commission_payer",
    grp: "referral",
    type: "referral_help",
    at: "02/09/2024",
    note: "Hỗ trợ khách Anh Tuấn làm hồ sơ nhanh",
    contract: "c14",
    by: "editor",
  },
  {
    party: "pvi",
    role: "commission_payer",
    grp: "referral",
    type: "reconcile_missing",
    at: "10/10/2024",
    note: "Hoa hồng Chị Lan (88.000đ) quá hạn 30 ngày",
    contract: "c14",
    by: "editor",
  },
];

export type RatingSpec = {
  party: PKey;
  role: Role;
  grp: Grp;
  stars: Record<string, number>;
  at: string;
  by: "owner" | "editor";
  reasons?: Record<string, string>;
};
export const RATINGS: readonly RatingSpec[] = [
  {
    party: "viettel",
    role: "supplier",
    grp: "service",
    at: "26/09/2024",
    by: "editor",
    stars: { on_time_delivery: 4, quality: 4, incident: 2, price_hold: 4, serial: 4 },
    reasons: { incident: "Sự cố hoá đơn xử lý chậm, tổng đài khó gọi" },
  },
  {
    party: "tanphat",
    role: "supplier",
    grp: "goods",
    at: "13/10/2024",
    by: "owner",
    stars: { on_time_delivery: 2, quality: 4, incident: 3, price_hold: 4 },
    reasons: { on_time_delivery: "Hàng ổn, giá tốt nhưng giao trễ và gọi mãi mới nghe máy" },
  },
  {
    party: "hungthinh",
    role: "customer",
    grp: "service",
    at: "30/09/2024",
    by: "editor",
    stars: { on_time_payment: 5, renew_via_us: 5, reminders: 5, debt: 5, complaints: 5 },
  },
];

export type NoteSpec = { party: PKey; body: string; at: string; by: "owner" | "editor" };
export const NOTES: readonly NoteSpec[] = [
  {
    party: "minhphat",
    body: "Chữ ký số của khách vẫn ký văn bản sau ngày hết hạn gói mua qua mình — có thể khách đã gia hạn thẳng với hãng.",
    at: "05/10/2024",
    by: "editor",
  },
  {
    party: "tanphat",
    body: "Bán cho mình hay trễ nhưng mua của mình thì trả sòng phẳng. Gọi qua zalo trước khi giao.",
    at: "13/10/2024",
    by: "owner",
  },
  {
    party: "fast",
    body: "Mới nhận 1 báo giá chữ ký số 1.150.000đ (08/2024), chưa giao dịch.",
    at: "10/08/2024",
    by: "owner",
  },
  {
    party: "hungthinh",
    body: "Khách chiến lược, ưu tiên giữ. Gia hạn đều mỗi năm.",
    at: "01/09/2024",
    by: "owner",
  },
];

/** Điểm đã chốt 6 tháng gần nhất (cũ → mới), theo ô nhóm × vai (xu hướng của mockup). */
export type TrendSpec = {
  party: PKey;
  role: Role;
  grp: Grp;
  scores: readonly number[];
  jobs: number;
};
export const TRENDS: readonly TrendSpec[] = [
  { party: "ncca", role: "supplier", grp: "service", scores: [80, 82, 83, 84, 86, 88], jobs: 6 },
  { party: "viettel", role: "supplier", grp: "service", scores: [86, 85, 85, 84, 82, 81], jobs: 5 },
  { party: "abc", role: "customer", grp: "service", scores: [80, 82, 85, 86, 85, 84], jobs: 4 },
  { party: "tanphat", role: "supplier", grp: "goods", scores: [78, 76, 74, 70, 66, 61], jobs: 6 },
  { party: "tanphat", role: "customer", grp: "goods", scores: [88, 89, 90, 90, 91, 92], jobs: 4 },
  {
    party: "hungthinh",
    role: "customer",
    grp: "service",
    scores: [88, 90, 92, 93, 94, 95],
    jobs: 7,
  },
  {
    party: "minhphat",
    role: "customer",
    grp: "service",
    scores: [84, 83, 80, 78, 74, 72],
    jobs: 5,
  },
  {
    party: "pvi",
    role: "commission_payer",
    grp: "referral",
    scores: [80, 78, 75, 70, 66, 62],
    jobs: 4,
  },
];
