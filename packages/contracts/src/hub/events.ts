// HUB-FR-89 · sự kiện Runtime XADD vào `run:<run_id>`, field `e` = JSON (plan H1 §2.3).
// Mỗi job đúng một `job.result` hoặc `job.failed`; `job.failed.message` chỉ vào log/`run_steps.detail` (P11).
import { z } from "zod";
import {
  AgentKeySchema,
  HubDateTimeSchema,
  HubUuidSchema,
  TokenUsageSchema,
  VersionSchema,
} from "./common";
import { HubJobErrorCodeSchema, JobFailReasonSchema } from "./errors";
import { AGENT_TEXT_MAX, AgentResultSchema } from "./result";

const base = {
  v: VersionSchema,
  job_id: HubUuidSchema,
  seq: z.number().int().min(1),
  at: HubDateTimeSchema,
};

export const JobStartedEventSchema = z.strictObject({
  ...base,
  type: z.literal("job.started"),
  worker_id: z.string().min(1).max(64),
  provider_key: AgentKeySchema,
});

/** Hub H1 chỉ coi là nhịp sống. */
export const JobProgressEventSchema = z.strictObject({
  ...base,
  type: z.literal("job.progress"),
  message: z.string().min(1).max(200),
  percent: z.number().int().min(0).max(100).nullable(),
});

export const JobOutputSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("agent_result"), result: AgentResultSchema }),
  z.strictObject({ kind: z.literal("text"), text: z.string().max(AGENT_TEXT_MAX) }),
]);
export type JobOutput = z.infer<typeof JobOutputSchema>;

export const JobResultEventSchema = z.strictObject({
  ...base,
  type: z.literal("job.result"),
  output: JobOutputSchema,
  usage: TokenUsageSchema,
  session_resumed: z.boolean(),
});

export const JOB_FAILED_STATUSES = ["failed", "cancelled", "timed_out"] as const;

export const JobFailedEventSchema = z.strictObject({
  ...base,
  type: z.literal("job.failed"),
  status: z.enum(JOB_FAILED_STATUSES),
  code: HubJobErrorCodeSchema,
  reason: JobFailReasonSchema.nullable(),
  message: z.string().min(1).max(500),
  usage: TokenUsageSchema,
});

export const RunEventSchema = z.discriminatedUnion("type", [
  JobStartedEventSchema,
  JobProgressEventSchema,
  JobResultEventSchema,
  JobFailedEventSchema,
]);
export type RunEvent = z.infer<typeof RunEventSchema>;
export type RunEventType = RunEvent["type"];
