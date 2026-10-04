// HUB-FR-27 · kết quả có cấu trúc của agent (plan H1 §2.4). `need_input` cùng dạng `AskSchema` của chat.
import { z } from "zod";

export const AGENT_TEXT_MAX = 64_000;
export const ASK_QUESTION_MAX = 2_000;
export const ASK_CHOICE_MAX = 200;
export const ASK_CHOICES_MAX = 6;
export const PARTIAL_MISSING_MAX = 2_000;

const TextSchema = z.string().min(1).max(AGENT_TEXT_MAX);
export const AskQuestionSchema = z.string().min(1).max(ASK_QUESTION_MAX);
export const AskChoicesSchema = z.array(z.string().min(1).max(ASK_CHOICE_MAX)).max(ASK_CHOICES_MAX);

export const AgentResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("done"), text: TextSchema }),
  z.strictObject({
    status: z.literal("partial"),
    text: TextSchema,
    missing: z.string().min(1).max(PARTIAL_MISSING_MAX),
  }),
  z.strictObject({
    status: z.literal("need_input"),
    question: AskQuestionSchema,
    choices: AskChoicesSchema,
  }),
]);
export type AgentResult = z.infer<typeof AgentResultSchema>;
