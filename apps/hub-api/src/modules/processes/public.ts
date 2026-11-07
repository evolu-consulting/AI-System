// ADR-0037 Â· cá»­a cÃ´ng khai DUY NHáº¤T cá»§a module `processes`: module khÃ¡c chá»‰ import file nÃ y (theo tÃªn, khÃ´ng `export *`). Ruá»™t lÃ  riÃªng cá»§a module.
export type { Bang } from "./core/bang.rules";
export { classifyBang } from "./core/bang.rules";
export { processError } from "./core/errors";
export type { ProcessStartPort } from "./core/ports";
export type { HandoffShape } from "./defs/def.rules";
export type { RunAccess } from "./domain/runs/run-access.rules";
export { agentIdOf, runsAsAgent } from "./nodes/registry";
export type { CredentialJobShape } from "./runs/apply.rules";
export { credentialJobAllows, credentialUsername } from "./runs/apply.rules";
export { reportMatchesJob } from "./runs/autofix.rules";
export { normSection, sectionMap } from "./runs/template.rules";
