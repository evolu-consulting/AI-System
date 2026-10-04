// HUB-FR-89 · manifest khai báo một agent type (plan H1 §2.5).
import { z } from "zod";
import { AgentKeySchema } from "./common";

export const AGENT_RUNTIMES = ["agentic-cli", "llm", "python"] as const;
const DescriptionTextSchema = z.string().min(1).max(400);

export const AgentTypeManifestSchema = z.strictObject({
  key: AgentKeySchema,
  runtime: z.enum(AGENT_RUNTIMES),
  description: z.strictObject({ vi: DescriptionTextSchema, en: DescriptionTextSchema }),
  config_schema: z.record(z.string(), z.unknown()),
  version: z.number().int().min(1),
});
export type AgentTypeManifest = z.infer<typeof AgentTypeManifestSchema>;
