// ADM-FR-23 · `POST /admin/commands/test` (plan X1 §2.2): Admin chạy thử bản nháp lệnh qua Hub `/internal/test-run`.
// Mã lỗi riêng, KHÔNG thêm vào `API_ERRORS` (khoá đếm 48, K4). Body lỗi = `ErrorResponseSchema` M0.
import { z } from "zod";
import { MessageContextSchema } from "./chat/entities";
import { UuidSchema } from "./common";
import {
  TEST_RUN_TEXT_MAX,
  TestRunRequestSchema,
  TestRunResponseSchema,
} from "./hub-internal/test-run";

/** Status theo HTTP; dùng kèm `FORBIDDEN`/`VALIDATION_ERROR`/`INVALID_REFERENCE` của `API_ERRORS`. */
export const COMMAND_TEST_ERRORS = {
  CMD_MISSING_ARG: 422,
  NOT_CONFIGURED: 409,
  SIDE_EFFECT_CONFIRM_REQUIRED: 409,
  HUB_UNAVAILABLE: 502,
  HUB_NOT_CONFIGURED: 503,
} as const satisfies Record<string, 409 | 422 | 502 | 503>;

export type CommandTestErrorCode = keyof typeof COMMAND_TEST_ERRORS;
export const COMMAND_TEST_ERROR_CODES = Object.keys(COMMAND_TEST_ERRORS) as CommandTestErrorCode[];
export const CommandTestErrorCodeSchema = z.enum(
  COMMAND_TEST_ERROR_CODES as [CommandTestErrorCode, ...CommandTestErrorCode[]],
);

export const CommandTestRequestSchema = z.strictObject({
  command: TestRunRequestSchema.shape.command,
  text: z.string().max(TEST_RUN_TEXT_MAX),
  context: MessageContextSchema.optional(),
  /** "Chạy với tư cách user": chỉ đặt actor gửi Hub; vắng = người gọi. */
  run_as_user_id: UuidSchema.optional(),
  /** Bắt buộc `true` khi workflow `side_effect` (409 `SIDE_EFFECT_CONFIRM_REQUIRED`). */
  confirm_side_effect: z.boolean().optional(),
});
export type CommandTestRequest = z.infer<typeof CommandTestRequestSchema>;

/** 200 cả khi run lỗi (`ok:false`); giữ `ms` (BL2). */
export const CommandTestResponseSchema = TestRunResponseSchema;
export type CommandTestResponse = z.infer<typeof CommandTestResponseSchema>;

export const SideEffectConfirmDetailsSchema = z.strictObject({ workflow_id: UuidSchema });
export type SideEffectConfirmDetails = z.infer<typeof SideEffectConfirmDetailsSchema>;
