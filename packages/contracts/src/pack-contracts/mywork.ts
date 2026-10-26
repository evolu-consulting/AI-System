// W1 · "Việc của tôi" (mgmt-app: thẻ đầu trợ lý `assistant/digest.py` + `/board`, `/followups`, `/obligations`): contract zod của
// `GET /pack/contracts/my-work` và `POST /pack/contracts/my-work/followups/:id/{done,snooze}`. Chỉ trả hàng người dùng THẤY
// (RLS M1) — hẹn nhắc (`cks_followups`) chỉ của chính họ. Hành động sổ thanh toán/ghi kết quả dùng route HD7/HD4 có sẵn.
import { z } from "zod";
import { CksLocalAtTime } from "./cks";

export const MYWORK_KINDS = ["followup", "obligation", "deadline", "reminder"] as const;
export type MyWorkKind = (typeof MYWORK_KINDS)[number];
export const MYWORK_TONES = ["late", "soon", "dim"] as const;
export type MyWorkTone = (typeof MYWORK_TONES)[number];
/** Số ngày nhìn trước và số hàng tối đa mỗi nguồn / tổng. */
export const MYWORK_AHEAD_DAYS = 7;
export const MYWORK_SOURCE_MAX = 100;
export const MYWORK_MAX = 200;

export const MyWorkQuerySchema = z.strictObject({});
export const SnoozeRequestSchema = z.strictObject({ at: CksLocalAtTime });
export type SnoozeRequest = z.infer<typeof SnoozeRequestSchema>;
export const DoneRequestSchema = z.strictObject({});

export type MyWorkItem = {
  /** `${kind}:${uuid}` — ổn định giữa các lần tải. */
  id: string;
  kind: MyWorkKind;
  tone: MyWorkTone;
  /** > 0 trễ n ngày; 0 hôm nay; < 0 còn n ngày. */
  days: number;
  /** Ngày lịch (múi tenant) `YYYY-MM-DD`; hẹn nhắc kèm giờ ở `at`. */
  due: string;
  at: string | null;
  title: string | null;
  party: string | null;
  amount: number | null;
  direction: "pay" | "receive" | null;
  /** Hướng HĐ ("sale"/"purchase") — gợi ý "so sánh giá trước khi gia hạn" cho HĐ mua. */
  contract_direction: "sale" | "purchase" | null;
  contract_id: string | null;
  customer_id: string | null;
  note: string | null;
  milestone: number | null;
  /** Hẹn nhắc: về gia hạn chữ ký / khách CKS (HD9), hoặc hẹn nhắc chung về đợt / HĐ / đối tác (tiêu đề do máy chủ đặt lúc hẹn). */
  subject: "renewal" | "customer" | "obligation" | "contract" | "company" | null;
};

/** contract-flow S3b · task duyệt HĐ (engine) đang chờ người xem quyết; chỉ có khi cờ duyệt trên engine bật. */
export type MyWorkApproval = {
  task_id: string;
  contract_id: string;
  contract_number: string | null;
  contract_title: string | null;
  stage_name: string;
  due_at: string | null;
  escalated: boolean;
};

export type MyWorkOut = {
  today: string;
  items: MyWorkItem[];
  counts: { late: number; today: number; upcoming: number };
  /** Một nguồn vượt MYWORK_SOURCE_MAX hoặc tổng vượt MYWORK_MAX ⇒ danh sách bị cắt. */
  truncated: boolean;
  /** S3b · việc duyệt HĐ trên engine (vắng khi duyệt engine tắt). */
  approvals?: MyWorkApproval[];
};
