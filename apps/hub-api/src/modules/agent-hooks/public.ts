// ADR-0037 · cửa công khai DUY NHẤT của module `agent-hooks`: module khác chỉ import file này (theo tên, không `export *`). Ruột là riêng của module.
export type { AgentHooksService } from "./hooks.service";
