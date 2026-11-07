// ADR-0037 · cửa công khai DUY NHẤT của module `agent-grants`: module khác chỉ import file này (theo tên, không `export *`). Ruột là riêng của module.
export { tenantOf } from "./agent-grants.routes";
export type { AgentGrantsService } from "./agent-grants.service";
