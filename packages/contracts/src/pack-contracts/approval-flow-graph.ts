// CR-184 · CR-185 · một stage của sơ đồ quy trình duyệt đang chạy (`graph[]` của GET /pack/contracts/approval-flow).
import { z } from "zod";
import { ApprovalFlowAssignedSchema, ApprovalFlowRoleSchema } from "./approval-flow-roles";

// CR-185 · trường của `graph[]` để Sổ Hợp Tác vẽ cùng sơ đồ với trang quản trị (gộp cụm node module, cạnh đầu ra, nhãn Kết thúc).
const StepIdx = z.number().int().min(0).max(999);
const GraphExtra = {
  /** Mã node module của stage (vd `contracts.esign`) + loại executor: Gửi ký + Chờ ký gộp thành MỘT ô như trang quản trị. */
  node: z.string().max(100).nullable().optional(),
  exec: z.string().max(40).nullable().optional(),
  /** Stage chờ: nhánh theo sự kiện (`on` → bước đích 0-based; null = chưa chọn) — cạnh Từ chối / Hết hạn của ô module. */
  wait_branches: z
    .array(z.strictObject({ on: z.string().max(100), step: StepIdx.nullable() }))
    .max(20)
    .optional(),
  /** Mã kết quả của stage Kết thúc (`approved` / `rejected` / `returned`…); stage khác ⇒ vắng. */
  outcome: z.string().max(100).nullable().optional(),
};

export const APPROVAL_FLOW_GRAPH_MAX = 60;
/** CR-184 · một stage của sơ đồ: đủ để dựng nút + cạnh (`step`, `yes`/`no`, `branch`, `back_to`, `next_step`). Số bước đếm từ 0. */
export const ApprovalFlowGraphStageSchema = z.strictObject({
  key: z.string().min(1).max(100),
  step: StepIdx,
  name: z.string().max(200),
  kind: z.enum(["review", "esign", "notify", "if", "partner_send", "wait", "end", "other"]),
  department_name: z.string().max(200).nullable().optional(),
  provider: z.string().max(100).nullable().optional(),
  after: z.enum(["review", "auto"]),
  back_to: z.array(StepIdx).max(20),
  branch: z.array(StepIdx.nullable()).max(20),
  yes: StepIdx.nullable(),
  no: StepIdx.nullable(),
  next_step: StepIdx.nullable(),
  terminal: z.boolean(),
  /** CR-182 · vai của bước Duyệt / Ký; null/vắng ⇒ bước không dùng vai. `assigned` null ⇒ vai CHƯA giao («Chưa giao người»). */
  role: ApprovalFlowRoleSchema.nullable().optional(),
  assigned: ApprovalFlowAssignedSchema.nullable().optional(),
  /** CR-182 · bước Ký cần chữ ký số (công tắc «Cần chữ ký số»); vắng ⇒ ký trên tài liệu. */
  need_digital: z.literal(true).optional(),
  ...GraphExtra,
});
export type ApprovalFlowGraphStage = z.infer<typeof ApprovalFlowGraphStageSchema>;
