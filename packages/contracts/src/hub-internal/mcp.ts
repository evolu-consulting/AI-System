// HUB-FR-95, WRK-FR-13 · MCP `/mcp` của Hub (plan H2a §2.3, §6; plan-errors §4–5).
import { z } from "zod";

/** Phiên bản MCP Hub nhận; phần tử đầu = ưu tiên. */
export const MCP_PROTOCOL_VERSIONS = [
  "2026-07-28",
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
] as const;
export type McpProtocolVersion = (typeof MCP_PROTOCOL_VERSIONS)[number];

export const TOOL_CONFIRM_QUESTION_MAX = 2000;
export const TOOL_CONFIRM_CHOICE_MAX = 200;

/**
 * `tools/call` với workflow `side_effect` chưa xác nhận: `isError:true`, `content[0].text` = JSON.stringify(object này),
 * `content[1].text` = câu chỉ dẫn, `structuredContent` = cùng object.
 */
export const ToolConfirmationRequiredSchema = z.strictObject({
  code: z.literal("CONFIRMATION_REQUIRED"),
  question: z.string().min(1).max(TOOL_CONFIRM_QUESTION_MAX),
  choices: z.tuple([
    z.string().min(1).max(TOOL_CONFIRM_CHOICE_MAX),
    z.string().min(1).max(TOOL_CONFIRM_CHOICE_MAX),
  ]),
});
export type ToolConfirmationRequired = z.infer<typeof ToolConfirmationRequiredSchema>;
