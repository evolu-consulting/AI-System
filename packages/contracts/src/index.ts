// ADM-NFR-06 · điểm vào contract dùng chung giữa admin-api, admin-web và test.
export {
  BASE_ERROR_CODES,
  type BaseErrorCode,
  type ErrorResponse,
  ErrorResponseSchema,
} from "./errors";
export { type HealthResponse, HealthResponseSchema } from "./health";
