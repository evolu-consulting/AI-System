// ADR-0037 · cửa công khai DUY NHẤT của module `processes`: module khác chỉ import file này (theo tên, không `export *`). Ruột là riêng của module.
export type { Bang } from "./core/bang.rules";
export { classifyBang } from "./core/bang.rules";
export { processError } from "./core/errors";
export type { ProcessStartPort } from "./core/ports";
export type { HandoffShape } from "./defs/def.rules";
export type { RunAccess } from "./domain/runs/run-access.rules";
export { COMMUNITY_FLOW_TEMPLATE } from "./library/flow-templates.community";
export {
  PURCHASE_PARENT,
  PURCHASE_PARENT_ID,
  PURCHASE_PHASE_KEYS,
  PURCHASE_TEMPLATES,
} from "./library/purchase-templates";
export { agentIdOf, runsAsAgent } from "./nodes/registry";
export type { CredentialJobShape } from "./runs/apply.rules";
export { credentialJobAllows, credentialUsername } from "./runs/apply.rules";
export { reportMatchesJob } from "./runs/autofix.rules";
export { packRecordPort } from "./runs/pack-run-record"; // cr125-contract-from-step
export { normSection, sectionMap } from "./runs/template.rules";
export { bindGroupKeys, groupKeysOf } from "./triggers/group-keys.rules"; // cr126-seed-esign-signer
