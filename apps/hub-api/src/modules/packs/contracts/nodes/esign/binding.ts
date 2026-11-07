// CR-125 · m4 · MOD-FR-01/04 · binding máy chủ của node «contracts.esign» — MỘT chỗ khai: tool gửi ký, schema args (= `configPort` của
// khai báo), validator cấu hình theo khoá tool, đường nạp lựa chọn cho panel. `intake.mount` đăng ký phần tĩnh (cùng lúc tool bước),
// `esign.mount` đăng ký validator (cần use case ký số). Gọi `bindNode` nhiều lần cùng khoá ⇒ gộp.
import { ESIGN_CONFIG_PORT } from "@ai/contracts/modules";
import type { NodeBinding } from "../../../kit/public";
import { ESIGN_NODE_KEY, esignNodeValidator } from "../../adapters/esign-node.validator";
import { INTAKE_TOOL_KEYS } from "../../adapters/intake.tools";

/** Phần tĩnh: tool + schema args + đường lựa chọn. */
export const esignBindingBase: NodeBinding = {
  key: ESIGN_NODE_KEY,
  tools: [INTAKE_TOOL_KEYS.esignSend],
  argsSchema: ESIGN_CONFIG_PORT.schema,
  optionsPath: "/pack/contracts/esign/options",
};

/** Phần cần use case: kiểm cấu hình lúc LƯU def, theo KHOÁ TOOL (def gọi thẳng tool không mang `node` cũng bị kiểm). */
export const esignBindingChecks = (
  check: Parameters<typeof esignNodeValidator>[0],
): NodeBinding => ({
  key: ESIGN_NODE_KEY,
  toolValidators: { [INTAKE_TOOL_KEYS.esignSend]: esignNodeValidator(check) },
});
