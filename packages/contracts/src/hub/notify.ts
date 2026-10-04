// HUB-FR-89 · kênh NOTIFY + key Redis Stream của Hub (plan H1 §2.5). `config_changed` là của Admin (`../config`).
import { z } from "zod";
import { AgentKeySchema, HubUuidSchema, VersionSchema } from "./common";

export const JOB_ENQUEUED_CHANNEL = "job_enqueued";
export const JOB_CANCEL_CHANNEL = "job_cancel";
export const HUB_CONFIG_CHANNEL = "hub_config_changed";

/** Field duy nhất của entry XADD, giá trị = JSON. */
export const RUN_STREAM_FIELD = "e";
/** Stream Runtime → Hub (`RunEvent`). */
export const runStreamKey = (runId: string): string => `run:${runId}`;
/** Stream SSE Hub → client (P9). */
export const sseStreamKey = (runId: string): string => `sse:${runId}`;

/** Hub NOTIFY trong cùng transaction INSERT job. */
export const JobEnqueuedPayloadSchema = z.strictObject({
  v: VersionSchema,
  job_id: HubUuidSchema,
  provider_key: AgentKeySchema,
});
export type JobEnqueuedPayload = z.infer<typeof JobEnqueuedPayloadSchema>;

export const JobCancelPayloadSchema = z.strictObject({
  v: VersionSchema,
  job_id: HubUuidSchema,
  run_id: HubUuidSchema,
});
export type JobCancelPayload = z.infer<typeof JobCancelPayloadSchema>;

/** `hub:seed` phát sau khi tăng `hub_config_version`. */
export const HubConfigChangedPayloadSchema = z.strictObject({
  v: VersionSchema,
  version: z.number().int().min(1),
});
export type HubConfigChangedPayload = z.infer<typeof HubConfigChangedPayloadSchema>;
