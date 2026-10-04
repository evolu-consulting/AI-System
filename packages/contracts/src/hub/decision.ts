// HUB-FR-89 · quyết định của Orchestrator mỗi vòng (plan H1 §2.4).
import { z } from "zod";
import { AgentKeySchema } from "./common";
import { AGENT_TEXT_MAX, AskChoicesSchema, AskQuestionSchema } from "./result";

export const DELEGATE_TASK_MAX = 8_000;

export const OrchestratorDecisionSchema = z.discriminatedUnion("decision", [
  z.strictObject({
    decision: z.literal("delegate"),
    agent: AgentKeySchema,
    task: z.string().min(1).max(DELEGATE_TASK_MAX),
  }),
  z.strictObject({ decision: z.literal("answer"), text: z.string().min(1).max(AGENT_TEXT_MAX) }),
  z.strictObject({
    decision: z.literal("ask"),
    question: AskQuestionSchema,
    choices: AskChoicesSchema,
  }),
]);
export type OrchestratorDecision = z.infer<typeof OrchestratorDecisionSchema>;
