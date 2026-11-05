// CR-121 phần B · ADR-0037 · cửa công khai DUY NHẤT của module `config`: module khác chỉ import file này
// (kiểu ảnh chụp cấu hình/danh mục, hàm thuần chọn điều phối + lệnh dùng được, `ConfigCache`; theo tên, không `export *`).
// Ruột (config.repo/service/rules, catalog.*, schema-*) là riêng của module.
export type { CatalogSnapshot, UsableCatalogCommand } from "./catalog.rules";
export { tenantKeyOf, usableCatalogCommands } from "./catalog.rules";
export type {
  AgentConfig,
  ConfigSnapshot,
  PickedOrchestrator,
  ProfileConfig,
  TenantAgentDefaults,
  UserState,
} from "./config.rules";
export { agentWorkflowIds, DEFAULT_TENANT_TZ, pickOrchestrator } from "./config.rules";
export type { ConfigChange } from "./config.service";
export { bootOrchestratorProblem, ConfigCache, startConfigCache } from "./config.service";
export { assertHubSchemaCaps } from "./schema-caps";
export { missingAdminColumns } from "./schema-check";
