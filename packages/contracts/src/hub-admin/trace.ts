// HUB-FR-52 · contract GET /runs/:id/trace (plan H3b §2.4, R17–R19). Không trường nào chứa payload/result/token
// (`jobs.payload/result/token_hash/error_message` không trả, PL9); `detail` đã qua `redactTraceDetail` ở Hub.
import { z } from "zod";
import { AGENT_KEY_PATTERN, IsoDateTime, UuidSchema } from "../common";

export const TRACE_STEPS_MAX = 200;
export const TRACE_JOBS_MAX = 200;
export const MASK = "••••";
export const TRACE_STEP_TYPES = ["orchestrator", "delegate", "workflow", "tool"] as const;

/** numeric → text (như usage M4). */
export const DecimalStringSchema = z.string().regex(/^-?\d+(\.\d+)?$/);
const Count = z.number().int().min(0);

export const StepUsageSchema = z.strictObject({
  model: z.string().nullable(),
  input_tokens: Count,
  output_tokens: Count,
  cost_usd: DecimalStringSchema.nullable(),
  billable_usd: DecimalStringSchema.nullable(),
});
export type StepUsage = z.infer<typeof StepUsageSchema>;

export const TraceMessageSchema = z.strictObject({
  id: UuidSchema,
  content: z.string(),
  created_at: IsoDateTime,
});
export type TraceMessage = z.infer<typeof TraceMessageSchema>;

/** `kind`/`status` để string: thêm giá trị Hub mới không phá contract quản trị. */
export const TraceRunSchema = z.strictObject({
  id: UuidSchema,
  tenant_id: UuidSchema,
  user_id: UuidSchema,
  kind: z.string(),
  status: z.string(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
  config_version: z.number().int(),
  conversation_id: UuidSchema,
  flow_id: UuidSchema,
  tokens_used: z.number().int(),
  started_at: IsoDateTime,
  finished_at: IsoDateTime.nullable(),
});
export type TraceRun = z.infer<typeof TraceRunSchema>;

export const TraceStepSchema = z.strictObject({
  id: UuidSchema,
  seq: z.number().int(),
  type: z.enum(TRACE_STEP_TYPES),
  agent: z.strictObject({ id: UuidSchema, key: z.string().regex(AGENT_KEY_PATTERN) }).nullable(),
  workflow_id: UuidSchema.nullable(),
  provider_key: z.string().nullable(),
  job_id: UuidSchema.nullable(),
  label_key: z.string(),
  status: z.string(),
  started_at: IsoDateTime,
  finished_at: IsoDateTime.nullable(),
  ms: z.number().int().nullable(),
  detail: z.record(z.string(), z.unknown()).nullable(),
  usage: StepUsageSchema.nullable(),
});
export type TraceStep = z.infer<typeof TraceStepSchema>;

export const TraceJobSchema = z.strictObject({
  id: UuidSchema,
  step_id: UuidSchema,
  type: z.string(),
  provider_key: z.string(),
  status: z.string(),
  attempts: z.number().int(),
  error_code: z.string().nullable(),
  error_reason: z.string().nullable(),
  created_at: IsoDateTime,
  started_at: IsoDateTime.nullable(),
  finished_at: IsoDateTime.nullable(),
});
export type TraceJob = z.infer<typeof TraceJobSchema>;

/** `truncated` = steps hoặc jobs vượt 200; `usage_total.model` luôn null. */
export const RunTraceSchema = z.strictObject({
  run: TraceRunSchema,
  messages: z.strictObject({
    user: TraceMessageSchema.nullable(),
    answer: TraceMessageSchema.nullable(),
  }),
  steps: z.array(TraceStepSchema).max(TRACE_STEPS_MAX),
  jobs: z.array(TraceJobSchema).max(TRACE_JOBS_MAX),
  usage_total: StepUsageSchema.extend({ model: z.null() }),
  truncated: z.boolean(),
});
export type RunTrace = z.infer<typeof RunTraceSchema>;
