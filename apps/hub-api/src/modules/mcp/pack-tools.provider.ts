// N2-FR-03 · N2-D03 · N2-AC09 · ngoại lệ CR-087 của HUB-BR-12: tool của gói trong `/mcp` (không bọc Dify). Liệt kê/gọi khi
// khoá ∈ `payload.mcp.tools` của job ∧ gói bật cho tenant ∧ user của job có quyền `read` gói ∧ tool KHÔNG side_effect (gói
// không có cổng xác nhận ⇒ hành động thật chỉ qua stage `real_action` sau duyệt). Chạy bằng danh tính user + tenant của job.
import type { WorkflowInput } from "@ai/contracts";
import type { PackToolArgs, PackToolCatalog } from "../packs/kit/application/pack-tools.ports";
import {
  type McpToolDef,
  type ToolResult,
  toolError,
  toolInputSchema,
  toolText,
  validateToolArgs,
} from "./mcp.rules";

/** `readOnly` (M2-chat · token chat Dify) ⇒ chỉ tool `action: read`. */
type Ctx = {
  tenantId: string;
  userId: string;
  runId: string;
  tools: readonly string[];
  readOnly?: boolean;
};

export type PackMcpTools = {
  tools(ctx: Ctx): Promise<McpToolDef[]>;
  accepts(
    ctx: Ctx,
    name: string | null | undefined,
  ): Promise<{ call(args: unknown): Promise<ToolResult> } | null>;
};

export function packMcpTools(packs: PackToolCatalog): PackMcpTools {
  const usable = async (ctx: Ctx, key: string): Promise<boolean> => {
    const info = packs.info(key);
    if (!info || info.sideEffect || !ctx.tools.includes(key)) return false;
    if (ctx.readOnly && info.action !== "read") return false;
    const who = { tenantId: ctx.tenantId, userId: ctx.userId };
    return (await packs.enabled(ctx.tenantId, key)) && (await packs.canUse(who, key));
  };
  const inputsOf = (key: string) => (packs.info(key)?.params ?? []) as unknown as WorkflowInput[];
  return {
    async tools(ctx) {
      const keys = ctx.tools.filter((k) => packs.has(k));
      const ok = await Promise.all(keys.map((k) => usable(ctx, k)));
      return keys
        .filter((_, i) => ok[i])
        .map((k) => ({
          name: k,
          description: packs.info(k)?.description ?? k,
          inputSchema: toolInputSchema(inputsOf(k)),
        }));
    },
    async accepts(ctx, name) {
      if (!name || !packs.has(name) || !(await usable(ctx, name))) return null;
      return {
        async call(args) {
          const v = validateToolArgs(inputsOf(name), args);
          if (!v.ok) return toolError("INVALID_ARGS");
          const res = await packs.call(
            name,
            { tenantId: ctx.tenantId, userId: ctx.userId, runId: ctx.runId },
            v.inputs as PackToolArgs,
          );
          return res.kind === "ok" ? toolText(res.text) : toolError("UPSTREAM_ERROR");
        },
      };
    },
  };
}
