// dlc-step-library · thư viện BƯỚC DLC dùng lại (chỉ platform_admin; mount ở GỐC hub cạnh route thư viện quy trình). Export lại qua
// `processes.ts`. `GET|POST /dlc-step-templates`, `PUT|DELETE /dlc-step-templates/:id` (PUT mang `version` — lệch ⇒ 409
// VERSION_CONFLICT; khoá trùng ⇒ 409 KEY_TAKEN). Canvas khe `dlc.*` chép mẫu thành bước; giới hạn = CHECK hub 0071 = luật gói DLC.
import { z } from "zod";
import { IsoDateTime, UuidSchema } from "../common";

/** Việc của bước — bản sao `DLC_ACTIONS` của gói DLC (hub-admin không kéo gói; test giữ khớp với gói + CHECK 0071). */
export const DLC_STEP_ACTIONS = [
  "intake",
  "spec",
  "qc",
  "setup",
  "build",
  "verify",
  "report",
  "deploy",
  "agent",
] as const;
export const DlcStepActionSchema = z.enum(DLC_STEP_ACTIONS);
export type DlcStepAction = z.infer<typeof DlcStepActionSchema>;

/** Chưa đạt ⇒ quay lại: `self` làm lại chính bước, `prev` bước ngay trước, <việc> = bước gần nhất đứng trước làm việc đó. */
export const DLC_REJECT_TO = ["self", "prev", ...DLC_STEP_ACTIONS] as const;
export const DlcRejectToSchema = z.enum(DLC_REJECT_TO);
export type DlcRejectTo = z.infer<typeof DlcRejectToSchema>;

export const DLC_STEP_LIMITS = {
  nameMax: 80,
  agentKeyMax: 64,
  instructionMax: 8_000,
  rounds: { min: 1, max: 10, default: 3 },
  timeoutMin: { min: 5, max: 1440, default: 60 },
} as const;
export const DLC_STEP_KEY_RE = /^[a-z][a-z0-9-]{0,39}$/;
/** Mã Group duyệt — khớp `GROUP_KEY_RE` của gói DLC. */
export const DLC_GATE_GROUP_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const L = DLC_STEP_LIMITS;

const FIELDS = {
  key: z.string().regex(DLC_STEP_KEY_RE),
  name: z.string().trim().min(1).max(L.nameMax),
  action: DlcStepActionSchema,
  /** Khoá agent Hub; null ⇒ agent mặc định của việc (việc `agent` bắt buộc có). */
  agent_key: z.string().trim().min(1).max(L.agentKeyMax).nullable(),
  instruction: z.string().max(L.instructionMax),
  /** Mã Group duyệt; null ⇒ chạy tiếp không chờ người. */
  gate_group: z.string().regex(DLC_GATE_GROUP_RE).nullable(),
  /** Chỉ khi có cổng; null ⇒ như `self`. */
  reject_to: DlcRejectToSchema.nullable(),
  max_rounds: z.number().int().min(L.rounds.min).max(L.rounds.max),
  timeout_min: z.number().int().min(L.timeoutMin.min).max(L.timeoutMin.max),
};
type Shape = {
  action: string;
  agent_key: string | null;
  gate_group: string | null;
  reject_to: string | null;
};
const rules = (v: Shape, ctx: z.RefinementCtx) => {
  if (v.action === "agent" && v.agent_key === null)
    ctx.addIssue({ code: "custom", path: ["agent_key"], message: "agent_key required" });
  if (v.gate_group === null && v.reject_to !== null)
    ctx.addIssue({ code: "custom", path: ["reject_to"], message: "reject_to needs gate_group" });
};

export const DlcStepTemplateInputSchema = z.strictObject(FIELDS).superRefine(rules);
export type DlcStepTemplateInput = z.infer<typeof DlcStepTemplateInputSchema>;
export const DlcStepTemplateUpdateSchema = z
  .strictObject({ ...FIELDS, version: z.number().int().min(1) })
  .superRefine(rules);
export type DlcStepTemplateUpdate = z.infer<typeof DlcStepTemplateUpdateSchema>;

export const DlcStepTemplateSchema = z.strictObject({
  id: UuidSchema,
  ...FIELDS,
  version: z.number().int().min(1),
  updated_at: IsoDateTime,
});
export type DlcStepTemplate = z.infer<typeof DlcStepTemplateSchema>;
/** Toàn bộ thư viện (vài chục mục — không phân trang), sắp theo tên. */
export const DlcStepTemplateListResponseSchema = z.strictObject({
  items: z.array(DlcStepTemplateSchema),
});
export type DlcStepTemplateListResponse = z.infer<typeof DlcStepTemplateListResponseSchema>;
