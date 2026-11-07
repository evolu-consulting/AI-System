// ADR-0037 · cửa công khai DUY NHẤT của module `secrets`: module khác chỉ import file này (theo tên, không `export *`). Ruột là riêng của module.
export type { SecretKey } from "./secrets.crypto";
export { secretsNotConfigured } from "./secrets.errors";
export { HubSecretReader, isSecretUseError } from "./secrets.use";
