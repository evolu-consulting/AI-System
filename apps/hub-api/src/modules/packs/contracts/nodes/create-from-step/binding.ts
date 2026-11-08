// CR-125 · cr125-contract-from-step · binding máy chủ của node «contracts.create-from-step»: tool tạo HĐ + cổng cấu hình (= schema args tool,
// MỘT nguồn) trong sổ module. `mountCreateFromStep` (create-from-step.mount.ts) đăng ký tool rồi gọi file này; `moduleRegistry.verify` kiểm lúc
// khởi động.
import { CREATE_FROM_STEP_TOOL, MODULES } from "@ai/contracts/modules";
import type { NodeBinding } from "../../../kit/public";

export const CREATE_FROM_STEP_KEY = "contracts.create-from-step";

/** Schema args của tool = đúng `configPort.schema` của khai báo (cùng tham chiếu ⇒ không `MOD_PORT_MISMATCH`). */
export const createFromStepBinding = (): NodeBinding => {
  const decl = MODULES.flatMap((m) => m.nodes).find((n) => n.key === CREATE_FROM_STEP_KEY);
  const schema = decl?.configPort?.schema;
  return {
    key: CREATE_FROM_STEP_KEY,
    tools: [CREATE_FROM_STEP_TOOL],
    // Tool trả `contract_id` (cùng khoá với đầu ra khai báo) ⇒ ghi vào output của bước; Ký số nhận qua nguồn «từ bước trước».
    outputs: ["contract_id"],
    ...(schema ? { argsSchema: schema } : {}),
  };
};
