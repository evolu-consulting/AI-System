// UC-01..UC-08 · subpath `@ai/contracts/chat`: contract Chat↔Hub (plan C1 §2). Không qua `src/index.ts` (plan §1 Q1).
// Đăng nhập dùng lại nguyên contract `/auth/*` của Admin.
export {
  type LoginRequest,
  LoginRequestSchema,
  type LoginResponse,
  LoginResponseSchema,
  type LogoutRequest,
  LogoutRequestSchema,
  type Me,
  MeSchema,
  REFRESH_COOKIE,
  type RefreshRequest,
  RefreshRequestSchema,
  type RefreshResponse,
  RefreshResponseSchema,
  type TokenGrant,
  TokenGrantSchema,
  X_CLIENT_EXTENSION,
  X_CLIENT_HEADER,
} from "../auth";
export { type ErrorResponse, ErrorResponseSchema } from "../errors";
export { type HealthResponse, HealthResponseSchema } from "../health";
export * from "./commands";
export * from "./entities";
export * from "./errors";
export * from "./events";
export * from "./rules";
