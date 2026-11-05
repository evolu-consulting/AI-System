// ADM-NFR-06, ADM-FR-01, ADM-FR-10, ADM-FR-62 · điểm vào contract dùng chung giữa admin-api, admin-web và test.
/**
 * @deprecated CR-121 B-2 (ADR-0037): barrel gốc `@ai/contracts` — đừng import mới từ đây. Dùng subpath theo file
 * (`@ai/contracts/access`, `/config`, `/chat`, `/hub-admin`…; xem `exports` trong package.json). Barrel còn lại
 * cho `import * as` và tương thích; codemod `tools/scripts/src/codemod-contracts-subpaths.ts` (`--check` báo file còn import).
 */
export * from "./access";
export * from "./app-catalog";
export * from "./app-manifest";
export * from "./app-roles";
export * from "./audit";
export * from "./auth";
export * from "./auth-limit";
export * from "./capabilities";
export * from "./command-test";
export * from "./commands";
export * from "./common";
export * from "./config";
export * from "./daily-limits";
export { dropEmptyEnv } from "./env-source";
export {
  BASE_ERROR_CODES,
  type BaseErrorCode,
  type ErrorResponse,
  ErrorResponseSchema,
} from "./errors";
export * from "./external-orgs";
export * from "./features";
export * from "./feedback";
export * from "./flow";
export * from "./grants";
export * from "./groups";
export { type HealthResponse, HealthResponseSchema } from "./health";
export * from "./notify";
export * from "./org";
export * from "./overview";
export * from "./pack-contracts";
export * from "./packs";
export * from "./quotas";
export * from "./secrets";
export * from "./tenants";
export * from "./totp";
export * from "./transfer";
export * from "./trello-config";
export * from "./usage";
export * from "./usage-analytics";
export * from "./users";
export * from "./version-conflict";
export * from "./workflow-runs";
export * from "./workflow-tools";
export * from "./workflows";
