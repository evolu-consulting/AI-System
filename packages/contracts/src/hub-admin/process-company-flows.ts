// CR-122 · ADR-0038 · FLOW2-FR-05/07/08/20 · view model danh sách flow của MỘT công ty (`hub.company_flows`, lát E1 tạo bảng + API,
// U2 dựng màn). Cộng thêm: `process-routing.ts`/`process-company.ts` (khe + luật định tuyến) giữ tới R1.
import { z } from "zod";
import { FLOW_EVENT_KEY_RE } from "../app-manifest/manifest";
import { ProcessKeySchema } from "../chat/processes";
import { UuidSchema } from "../common";
import { FlowSourceSchema } from "./process-flowdef";

/** `company` = quy trình của chính công ty (tự tạo từ sơ đồ trống; quản trị nền tảng sửa). CR-127 Z7: không còn flow dùng chung gán cho công ty. */
export const COMPANY_FLOW_KINDS = ["company"] as const;
/** Lý do dòng đang Tắt (UI nói rõ trạng thái + lý do — Luật GỐC 3); null khi Bật. */
export const COMPANY_FLOW_OFF_REASONS = [
  "replaced", // đã thay bằng bản công ty (`replaced_by`)
  "reverted", // bản công ty sau khi "Quay về bản gốc"
  "turned_off", // quản trị tắt
  "not_published", // chưa có bản xuất bản
] as const;
/** Cảnh báo trên dòng (FLOW2-FR-20): flow `decides` bị flow trên không điều kiện che ⇒ không bao giờ chạy. */
export const COMPANY_FLOW_WARNINGS = ["shadowed_by_unconditional", "group_missing"] as const;
/** CR-122 · P15: `group_missing` = bản công ty còn bước duyệt chưa chọn nhóm ("Nhóm <mã> chưa có ở công ty — chọn nhóm khác"). */

export const CompanyFlowRowSchema = z.strictObject({
  /** id dòng `company_flows`. */
  id: UuidSchema,
  flow_id: UuidSchema,
  flow_key: ProcessKeySchema,
  name: z.string(),
  app: z.string(),
  kind: z.enum(COMPANY_FLOW_KINDS),
  trigger_event: z.string().regex(FLOW_EVENT_KEY_RE),
  /** Node Bắt đầu khi có điều kiện. */
  has_condition: z.boolean(),
  enabled: z.boolean(),
  /** Thứ tự xét (nhỏ trước) — sự kiện `decides` chỉ flow khớp đầu tiên chạy. */
  position: z.number().int().min(0),
  replaced_by: UuidSchema.nullable(),
  off_reason: z.enum(COMPANY_FLOW_OFF_REASONS).nullable(),
  /** Bản công ty sao từ Thư viện ("Sao từ <tên> · vN"); null với flow được gán / bản tự tạo. */
  source: FlowSourceSchema.extend({ name: z.string() }).nullable(),
  /** Bản xuất bản đang chạy; null = chưa xuất bản. */
  rel_version: z.number().int().min(1).nullable(),
  /** Thư viện có bản mới hơn bản đã sao (H5: chỉ báo, không ghi đè). */
  library_newer: z.number().int().min(1).nullable(),
  warnings: z.array(z.enum(COMPANY_FLOW_WARNINGS)).max(4),
  /** CR-127 · M1 · lần sửa gần nhất của def (ISO) — cột «Cập nhật» của trang Quy trình. */
  updated_at: z.string().optional(),
  /** CR-127 · Z7 · `version` của def (gửi kèm khi xoá, 409 nếu lệch). */
  def_version: z.number().int().min(1),
  /** CR-127 · Z7 · xoá được = còn NHÁP (chưa xuất bản/áp dụng) và chưa có lượt chạy nào ⇒ UI hiện «Xoá»; ngược lại gợi ý Tắt. */
  deletable: z.boolean(),
});
export type CompanyFlowRow = z.infer<typeof CompanyFlowRowSchema>;
export const CompanyFlowListSchema = z.strictObject({
  items: z.array(CompanyFlowRowSchema).max(200),
});

/** CR-127 · M1 · `POST /tenants/:tid/company-flows` dạng TẠO: tên + app + sơ đồ trống (`from:"blank"` — CR-127 Z5: không còn tạo từ mẫu). CR-127 Z7: dạng gán `{flow_id}` đã gỡ. */
export const CompanyFlowCreateSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  app: z.string().min(1).max(64).optional(),
  from: z.literal("blank"),
});
export type CompanyFlowCreate = z.infer<typeof CompanyFlowCreateSchema>;
