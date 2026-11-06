// CR-122 · E5b · FLOW2-FR-25 · validator cấu hình node Ký số khi LƯU def: đọc `args` HẰNG của stage tool `contracts-esign-send`, kiểm dạng
// (`decodeEsignNodeArgs`) rồi kiểm theo công ty (`checkNode`: nhà cung cấp đang bật, người/Group thuộc công ty). Path `stages.<i>.executor.args.<khoá>`.
import { decodeEsignNodeArgs, type EsignNodeConfig } from "@ai/contracts/pack-contracts";
import { constToolArgs, type NodeConfigValidator } from "../../kit/public";
import { INTAKE_TOOL_KEYS } from "./intake.tools";

type Check = (tenantId: string, c: EsignNodeConfig) => Promise<{ field: string; code: string }[]>;

export const ESIGN_NODE_KEY = "contracts.esign";

export function esignNodeValidator(check: Check): NodeConfigValidator {
  return async (tenantId, st) => {
    const args = constToolArgs(st.executor, INTAKE_TOOL_KEYS.esignSend);
    if (!args) return [];
    const base = `stages.${st.index}.executor.args`;
    const dec = decodeEsignNodeArgs(args);
    if (!dec.ok) return dec.issues.map((f) => ({ path: `${base}.${f}`, code: "INVALID" }));
    return (await check(tenantId, dec.config)).map((i) => ({
      path: `${base}.${i.field}`,
      code: i.code,
    }));
  };
}
