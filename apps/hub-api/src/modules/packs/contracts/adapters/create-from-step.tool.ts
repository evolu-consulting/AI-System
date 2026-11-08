// CR-125 · cr125-contract-from-step · tool gói `contracts-create-from-step` (stage tool của node «Tạo hợp đồng từ hồ sơ», danh tính = người
// bắt đầu run, công ty = công ty của run). Tạo MỘT bản ghi HĐ trong Sổ Hợp Tác từ tệp của bước Soạn thảo qua ĐÚNG use case tải lên hiện có
// (`createUploadContract` + `prefill`: cùng đường ghi tệp FileBox + quota + `contracts.files/contracts`; KHÔNG có đường ghi thứ hai), rồi gắn
// lượt chạy với HĐ (`process_runs.pack_key/pack_record_id`) để Ký số nhận `contract_id` và tín hiệu `esign.*` tìm được đúng lượt.
// Idempotent theo lượt: lượt đã gắn HĐ ⇒ trả lại HĐ đó (engine thử lại không tạo đôi). Không log nội dung tệp.
import {
  CREATE_FROM_STEP_FILE_MISSING,
  CREATE_FROM_STEP_TOOL,
  CREATE_FROM_STEP_UPLOAD_FAILED,
  planCreateFromStep,
} from "@ai/contracts/modules";
import type { PackToolCtx, PackToolDef } from "../../kit/public";
import { UploadError } from "../application/upload-contract.ports";
import type { UploadContract } from "../application/upload-contract.usecase";
import { manualFields } from "../domain/manual.rules";
import { withBusinessCodes } from "./intake.errors";

export const CREATE_FROM_STEP_NO_RUN = "CONTRACT_STEP_NO_RUN";

/** Tệp của bước trước (đọc theo id, đúng công ty); không có / đã xoá / công ty khác ⇒ null. */
export type StepFile = { name: string; bytes: Uint8Array };

export type CreateFromStepDeps = {
  upload: UploadContract;
  readFile: (tenantId: string, fileId: string) => Promise<StepFile | null>;
  timeZoneOf: (tenantId: string) => Promise<string>;
  /** Cầu engine: HĐ đã gắn vào lượt (nếu có) + gắn HĐ vừa tạo vào lượt (chỉ khi lượt chưa gắn bản ghi nào). */
  link: {
    recordOf(tenantId: string, runId: string): Promise<string | null>;
    attach(tenantId: string, runId: string, contractId: string): Promise<boolean>;
  };
};

const PARAMS: PackToolDef["params"] = [
  { name: "file_id", type: "text", required: true, description: "Tệp hợp đồng" },
  { name: "title", type: "text", required: false, description: "Tên hợp đồng" },
  { name: "counterparty", type: "text", required: false, description: "Đối tác" },
  { name: "amount", type: "number", required: false, description: "Giá trị hợp đồng" },
];

export function createFromStepTool(d: CreateFromStepDeps): PackToolDef {
  return {
    pack: "contracts",
    name: CREATE_FROM_STEP_TOOL,
    action: "write",
    description: "Tạo hợp đồng trong Sổ Hợp Tác từ tệp ở bước Soạn thảo của quy trình.",
    // Ghi bản ghi nội bộ của công ty (chưa gửi ra ngoài) ⇒ không phải «hành động thật»; idempotent theo lượt nên thử lại an toàn.
    side_effect: false,
    params: PARAMS,
    run: withBusinessCodes((ctx, args) => run(d, ctx, args)),
  };
}

async function run(d: CreateFromStepDeps, ctx: PackToolCtx, args: Record<string, unknown>) {
  const runId = ctx.processRunId;
  if (!runId) throw new Error(CREATE_FROM_STEP_NO_RUN);
  const plan = planCreateFromStep(args);
  if (!plan.ok) throw new Error(plan.code);
  const existing = await d.link.recordOf(ctx.tenantId, runId);
  if (existing) return { status: "exists", contract_id: existing };
  const file = await d.readFile(ctx.tenantId, plan.plan.fileId);
  if (!file) throw new Error(CREATE_FROM_STEP_FILE_MISSING);
  const { title, counterparty, amount } = plan.plan;
  // Đối tác vào bên bán (quy trình mua hàng); giá trị vào `total_value` — cùng luật trường với HĐ nhập tay.
  const fields = manualFields({
    direction: "purchase",
    title,
    partner_name: counterparty ?? "",
    total_value: amount,
    items: [],
  });
  const made = await d
    .upload({
      who: { tenantId: ctx.tenantId, userId: ctx.userId },
      timeZone: await d.timeZoneOf(ctx.tenantId),
      bytes: file.bytes,
      name: file.name,
      title,
      kind: "contract",
      parentId: null,
      prefill: { fields },
    })
    .catch((e: unknown) => {
      if (e instanceof UploadError) throw new Error(`${CREATE_FROM_STEP_UPLOAD_FAILED}:${e.code}`);
      throw e;
    });
  await d.link.attach(ctx.tenantId, runId, made.id);
  return { status: "created", contract_id: made.id };
}
