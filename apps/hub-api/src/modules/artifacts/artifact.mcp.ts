// CR-114 · hub-agent-handoff · tool MCP `artifact-get` / `artifact-search` trên `/mcp` của Hub (cùng dạng nhà cung cấp
// `tools(ctx)` / `accepts(ctx, name)` như `kh-query`). Tên dùng `-` vì khoá tool của `payload.mcp.tools` theo
// `CATALOG_KEY_RE` (không có dấu chấm). Phạm vi token: tool phải có trong `payload.mcp.tools` của job (runner cấp cho mọi
// agent `agentic-cli` khi bật), đọc theo tenant/user (RLS) + `run_id` của job; token chat chỉ đọc không có.
// Không phân biệt "không có" với "của tenant/run khác".
import { MCP_TOOLS_MAX } from "@ai/contracts/hub";
import { z } from "zod";
import { type McpToolDef, type ToolResult, toolError, toolText } from "../mcp/mcp.rules";
import { artifactHandoffOn } from "./artifact.flag";
import type { ArtifactStore } from "./artifact.service";

export const ARTIFACT_GET = "artifact-get";
export const ARTIFACT_SEARCH = "artifact-search";
export const ARTIFACT_TOOL_KEYS = [ARTIFACT_GET, ARTIFACT_SEARCH] as const;

/** Runner: bật bàn giao ⇒ mọi job agent có `artifact-get/search` trong `payload.mcp.tools` (≤ `MCP_TOOLS_MAX`). */
export function withArtifactTools(keys: string[], on = artifactHandoffOn()): string[] {
  if (on)
    for (const k of ARTIFACT_TOOL_KEYS)
      if (keys.length < MCP_TOOLS_MAX && !keys.includes(k)) keys.push(k);
  return keys;
}

/** fix114 · job THỰC SỰ đọc được artifact: `payload.mcp` (sau `withArtifactTools` + `mcpConfigFor`) có `artifact-get`. */
export const artifactToolsGranted = (mcp: { tools: readonly string[] } | null): boolean =>
  mcp?.tools.includes(ARTIFACT_GET) === true;

/**
 * fix114 · prompt/lịch sử job dùng: `byRef` chỉ khi đã cấp `artifact-get` cho đúng job này; còn lại (noTools ⇒ không MCP,
 * đủ `MCP_TOOLS_MAX`, không URL `/mcp`, cờ tắt) ⇒ nguyên văn như khi tắt cờ.
 */
export function jobVariant<T extends { prompt: string; history: readonly unknown[] }>(
  task: T & { byRef?: { prompt: string; history: T["history"] } },
  mcp: { tools: readonly string[] } | null,
): { prompt: string; history: T["history"] } {
  return task.byRef && artifactToolsGranted(mcp) ? task.byRef : task;
}

/** `tools` = `payload.mcp.tools` của job; `runId` rỗng ⇒ cả tenant (chỉ dùng trong test/việc nền). */
export type ArtifactMcpCtx = {
  tenantId: string;
  userId: string;
  runId?: string;
  tools: readonly string[];
  readOnly?: boolean;
};

const allowed = (ctx: ArtifactMcpCtx, name: string | null | undefined): boolean =>
  !ctx.readOnly && !!name && ctx.tools.includes(name);

const GetArgs = z.object({
  key: z.string().min(1).max(80),
  range: z
    .object({ start: z.number().int().min(0).optional(), len: z.number().int().min(1).optional() })
    .optional(),
});
const SearchArgs = z.object({
  query: z.string().min(1).max(500),
  k: z.number().int().min(1).max(20).optional(),
});

const TOOLS: McpToolDef[] = [
  {
    name: ARTIFACT_GET,
    description:
      "Read a stored artifact (output of an earlier step) by key like `art:3f9c21e8`. Use `range` {start,len} (characters) to read only the part you need; the result says the total length.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Artifact key, e.g. art:3f9c21e8" },
        range: {
          type: "object",
          properties: {
            start: { type: "integer", minimum: 0 },
            len: { type: "integer", minimum: 1 },
          },
        },
      },
      required: ["key"],
    },
  },
  {
    name: ARTIFACT_SEARCH,
    description: "Search stored artifacts of this workspace; returns keys + one-line summaries.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        k: { type: "integer", minimum: 1, maximum: 20 },
      },
      required: ["query"],
    },
  },
];

const NOT_FOUND: ToolResult = {
  content: [{ type: "text", text: "Artifact not found (unknown, expired or ambiguous key)." }],
  isError: true,
};

export class ArtifactMcpTools {
  constructor(private readonly store: ArtifactStore) {}

  tools(ctx: ArtifactMcpCtx): McpToolDef[] {
    return TOOLS.filter((t) => allowed(ctx, t.name));
  }

  accepts(
    ctx: ArtifactMcpCtx,
    name: string | null | undefined,
  ): { call(args: unknown): Promise<ToolResult> } | null {
    if (!allowed(ctx, name)) return null;
    if (name === ARTIFACT_GET) return { call: (a) => this.#get(ctx, a) };
    if (name === ARTIFACT_SEARCH) return { call: (a) => this.#search(ctx, a) };
    return null;
  }

  async #get(ctx: ArtifactMcpCtx, raw: unknown): Promise<ToolResult> {
    const a = GetArgs.safeParse(raw ?? {});
    if (!a.success) return toolError("INVALID_ARGS");
    const r = await this.store.get(ctx, a.data.key, a.data.range);
    if (!r) return NOT_FOUND;
    const head = `${r.ref.short} · ${r.kind} · chars ${r.start}-${r.end} of ${r.total}`;
    return toolText(`${head}\n${r.text}`);
  }

  async #search(ctx: ArtifactMcpCtx, raw: unknown): Promise<ToolResult> {
    const a = SearchArgs.safeParse(raw ?? {});
    if (!a.success) return toolError("INVALID_ARGS");
    const hits = await this.store.search(ctx, a.data.query, a.data.k ?? 5);
    if (hits.length === 0) return toolText("No artifacts found.");
    return toolText(hits.map((h) => `${h.ref} (${h.tokens} tok): ${h.summary}`).join("\n"));
  }
}
