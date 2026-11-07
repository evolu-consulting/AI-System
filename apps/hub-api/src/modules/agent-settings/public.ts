// ADR-0037 · cửa công khai DUY NHẤT của module `agent-settings`: module khác chỉ import file này (theo tên, không `export *`). Ruột là riêng của module.
export type { AgentSettingsService } from "./agent-settings.service";
