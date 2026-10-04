// ADM-FR-24, HUB-FR-89 · `POST /internal/test-run` (Admin → Hub, luôn chạy sync; plan H2a §2.3–2.4).
// Ghép từ schema M2 có sẵn (không `pick` trên schema có `refine`); được dùng zod đủ (không xuất pydantic).
import { z } from "zod";
import { ChatRunErrorCodeSchema, MessageContextSchema } from "../chat/entities";
import { ArgsSchema, CommandOutputSchema, InputMapSchema, TimeoutSchema } from "../commands";
import { UuidSchema } from "../common";

export const TEST_RUN_TEXT_MAX = 16_000;
export const TEST_RUN_OUTPUT_MAX = 64_000;
export const TEST_RUN_STEPS_MAX = 10;
export const TEST_RUN_TIMEOUT_DEFAULT_S = 30;

export const TestRunRequestSchema = z.strictObject({
  command: z.strictObject({
    workflow_id: UuidSchema,
    args: ArgsSchema.default([]),
    input_map: InputMapSchema.default({}),
    output: CommandOutputSchema,
    timeout_s: TimeoutSchema.default(TEST_RUN_TIMEOUT_DEFAULT_S),
  }),
  /** Phần sau tên lệnh. */
  text: z.string().max(TEST_RUN_TEXT_MAX),
  context: MessageContextSchema.optional(),
  actor_user_id: UuidSchema,
});
export type TestRunRequest = z.infer<typeof TestRunRequestSchema>;

export const TestRunStepSchema = z.strictObject({
  label: z.string().min(1).max(64),
  status: z.enum(["ok", "failed"]),
  ms: z.number().int().min(0),
});
export type TestRunStep = z.infer<typeof TestRunStepSchema>;

export const TestRunUsageSchema = z.strictObject({
  input_tokens: z.number().int().min(0),
  output_tokens: z.number().int().min(0),
  cost_usd: z.number().min(0),
});
export type TestRunUsage = z.infer<typeof TestRunUsageSchema>;

const tail = {
  steps: z.array(TestRunStepSchema).max(TEST_RUN_STEPS_MAX),
  usage: TestRunUsageSchema,
  ms: z.number().int().min(0),
};

/** 200 cả khi run lỗi (`ok:false`). */
export const TestRunResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), output: z.string().max(TEST_RUN_OUTPUT_MAX), ...tail }),
  z.strictObject({
    ok: z.literal(false),
    error: z.strictObject({
      code: ChatRunErrorCodeSchema,
      message: z.string().min(1).max(500),
      detail: z.string().max(300).nullable(),
    }),
    ...tail,
  }),
]);
export type TestRunResponse = z.infer<typeof TestRunResponseSchema>;
