// CR-121 c9 · thư viện quy trình theo CÔNG TY (R9): đọc chỉ-xem `GET /tenants/:tid/process-library/:id` + sao chép bản riêng
// `POST /tenants/:tid/process-defs/:id/clone-for-company`. Vai: platform_admin mọi tenant · tenant_admin CHỈ tenant mình
// (tenant lạ ⇒ 404) · member 403. Export lại qua `processes.ts`.
import { z } from "zod";
import { ProcessRunListItemSchema } from "../chat/processes-api";
import { UuidSchema } from "../common";
import { SlotKeySchema } from "./process-library";

/** Body `{}` (không nhận trường nào — công ty lấy từ đường dẫn). */
export const CloneForCompanyRequestSchema = z.strictObject({});
export type CloneForCompanyRequest = z.infer<typeof CloneForCompanyRequestSchema>;

/** 201 `created:true` (mới) · 200 `created:false` (đã có bản riêng từ nguồn này). `rel_version` = bản xuất bản của nguồn lúc sao. */
export const CloneForCompanyResponseSchema = z.strictObject({
  def_id: UuidSchema,
  source_template_id: UuidSchema,
  rel_version: z.number().int().min(1),
  created: z.boolean(),
});
export type CloneForCompanyResponse = z.infer<typeof CloneForCompanyResponseSchema>;

/** Số lượt chạy gần nhất của công ty trả kèm (chỉ đọc; danh sách đầy đủ: `GET /process-runs?def_id=`). */
export const PROCESS_LIBRARY_VIEW_RUNS_MAX = 20;

/**
 * `GET /tenants/:tid/process-library/:id` — def thư viện ở BẢN XUẤT BẢN hiện hành (chưa xuất bản ⇒ 404) + lượt chạy của công ty
 * `:tid` theo def đó. Chỉ đọc: `read_only` luôn `true`, không có quyền sửa/xuất bản.
 */
export const ProcessLibraryViewSchema = z.strictObject({
  read_only: z.literal(true),
  def_id: UuidSchema,
  slot: SlotKeySchema,
  slot_label: z.string(),
  name: z.string(),
  description: z.string(),
  rel_version: z.number().int().min(1),
  stages: z.array(z.unknown()),
  slot_body: z.unknown(),
  /** Bản riêng của công ty đã sao từ def này (null = chưa sao) — để UI hiện "Đã có bản riêng" thay vì nút Sao chép. */
  company_copy: z
    .strictObject({ def_id: UuidSchema, rel_version: z.number().int().min(1) })
    .nullable(),
  runs: z.array(ProcessRunListItemSchema).max(PROCESS_LIBRARY_VIEW_RUNS_MAX),
});
export type ProcessLibraryView = z.infer<typeof ProcessLibraryViewSchema>;
