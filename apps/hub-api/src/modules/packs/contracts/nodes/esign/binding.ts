// CR-125 · m4 · MOD-FR-01/04 · binding máy chủ của node «contracts.esign» — MỘT chỗ khai: tool gửi ký, schema args (= `configPort` của
// khai báo), validator cấu hình theo khoá tool, đường nạp lựa chọn cho panel. `intake.mount` đăng ký phần tĩnh (cùng lúc tool bước),
// `esign.mount` đăng ký validator (cần use case ký số). Gọi `bindNode` nhiều lần cùng khoá ⇒ gộp.
import { ESIGN_CONFIG_PORT } from "@ai/contracts/modules";
import { decodeEsignNodeArgs, ESIGN_NODE_PARAMS } from "@ai/contracts/pack-contracts";
import { z } from "zod";
import type { NodeBinding } from "../../../kit/public";
import { ESIGN_NODE_KEY, esignNodeValidator } from "../../adapters/esign-node.validator";
import { INTAKE_TOOL_KEYS } from "../../adapters/intake.tools";

type Scalar = string | number | boolean;
const PARAMS = new Set<string>(ESIGN_NODE_PARAMS);
const isScalar = (x: unknown): x is Scalar =>
  typeof x === "string" || typeof x === "number" || typeof x === "boolean";

/** Def ĐÃ LƯU ⇒ dạng logic: bỏ khoá ngoài cấu hình (`provider` cũ — người ký chọn cách ký lúc ký; `contract_id`…), giải dạng args
 *  (`company_signers` = chuỗi `user:<uuid>,…`, "true"/"3"). Giá trị dạng logic (mảng) giữ nguyên. */
function storedToConfig(v: unknown): unknown {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  const scalars: Record<string, Scalar> = {};
  const rest: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    if (!PARAMS.has(k) || x === "" || x === undefined) continue;
    if (isScalar(x)) scalars[k] = x;
    else rest[k] = x;
  }
  const d = decodeEsignNodeArgs(scalars);
  return d.ok ? { ...d.config, ...rest } : { ...scalars, ...rest };
}

/** Schema args của tool: cùng hình dạng vào với `configPort` (so `MOD_PORT_MISMATCH`), nhận cả def đã lưu (có `provider`, chuỗi người ký). */
export const esignArgsSchema = z.preprocess(storedToConfig, ESIGN_CONFIG_PORT.schema);

/** Phần tĩnh: tool + schema args + đường lựa chọn. */
export const esignBindingBase: NodeBinding = {
  key: ESIGN_NODE_KEY,
  tools: [INTAKE_TOOL_KEYS.esignSend],
  argsSchema: esignArgsSchema,
  optionsPath: "/pack/contracts/esign/options",
  // CR-125 · m8 · stage chờ ghi `event` (đã ký / từ chối / huỷ / hết hạn) vào output của bước (`stage-timer.repo.ts` · WAIT_EVENT_FIELD).
  // CR-125 · m9 · cùng output đó: `envelope_id` + (ký xong) `signed_at` / `signer` — dữ liệu kèm `esign.*` (`domain/esign-outputs.rules.ts`).
  outputs: ["event", "signed_at", "signer", "envelope_id"],
};

/** Phần cần use case: kiểm cấu hình lúc LƯU def, theo KHOÁ TOOL (def gọi thẳng tool không mang `node` cũng bị kiểm). */
export const esignBindingChecks = (
  check: Parameters<typeof esignNodeValidator>[0],
): NodeBinding => ({
  key: ESIGN_NODE_KEY,
  toolValidators: { [INTAKE_TOOL_KEYS.esignSend]: esignNodeValidator(check) },
});
