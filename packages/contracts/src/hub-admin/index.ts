// HUB-FR-78, HUB-FR-79, HUB-FR-52, ADM-FR-37 · subpath `@ai/contracts/hub-admin`: API quản trị Hub (plan H3b §2).
// Không qua `src/index.ts`; `chat`, `hub`, `hub-internal` không đổi (R21).
export { type ErrorResponse, ErrorResponseSchema } from "../errors";
export { type GrantSubject, GrantSubjectSchema } from "../grants";
export { type GroupRef, GroupRefSchema } from "../groups";
export * from "./agent-grants";
export * from "./agent-settings";
export * from "./effective";
export * from "./errors";
export * from "./trace";
