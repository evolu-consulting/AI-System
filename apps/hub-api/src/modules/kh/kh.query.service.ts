// HUB-FR-132 · HUB-FR-134 · HUB-BR-31 · K1-AC04 · K1-AC06 · CR-073 · plan K1 §3.4 bước 2–3, D7, D9, G3, G4, G9 · tool MCP
// `kh-query`: `tools/list` (mô tả + enum nhãn) và `tools/call`: args sai ⇒ INVALID_ARGS · project sai ⇒ KH_PROJECT (không
// đếm) · kết nối hết dùng được ⇒ `disabled` + audit `degrade`, KH_UNAVAILABLE (không đếm) · đếm nguyên tử ≤ 5 theo
// (stage_run, attempt, round) ⇒ KH_LIMIT · `POST /vector/query` ⇒ ghép ≤ 4000 ký tự. KH lỗi ⇒ `last_warning` + audit
// `degrade`, KH_UNAVAILABLE (đã đếm). Khoá chỉ đọc trong `KhClient` quanh `fetch`; log chỉ `{connection_id, code, http_status}`.
import {
  KH_QUERY_LIMIT,
  KH_QUERY_TEXT_MAX,
  KH_TOOL_KEY,
  type KhWarningCode,
} from "@ai/contracts/hub-admin";
import { withHubScope } from "@ai/db/hub-scope";
import { z } from "zod";
import type { Db } from "../../lib/db";
import { safeErrorFields } from "../../lib/errors";
import { dbHubAudit, type HubAuditWriter } from "../../lib/hub-audit";
import type { Logger } from "../../lib/logger";
import { type McpToolDef, type ToolResult, toolError } from "../mcp/mcp.rules";
import {
  type KhJobItem,
  khResolveProject,
  khToolDescription,
  khToolInputSchema,
} from "./kh.agent.rules";
import type { KhConn } from "./kh.client";
import { isKhCallError } from "./kh.client";
import type { KhRuntime } from "./kh.mount";
import { khPackHits, khToolText } from "./kh.query.rules";
import {
  bumpKhUsage,
  type KhConnRow,
  type KhUsageKey,
  readConn,
  setKhWarning,
  usageKeyOf,
} from "./kh.repo";
import { khConnectionUsable, khUrlPolicy } from "./kh.rules";
import { worklogSubject } from "./kh.summary.rules";

/** `ctx.kh` của MCP (D6): KH chốt lúc tạo job + stage của run. */
export type KhJobCtx = { items: KhJobItem[]; stageRunId: string };
/** Phần `McpContext` tool cần (tránh vòng import với `mcp.service`). */
export type KhMcpCtx = {
  tenantId: string;
  runId: string;
  tools: readonly string[];
  kh: KhJobCtx | null;
};

const ItemSchema = z.object({
  connection_id: z.string().uuid(),
  name: z.string(),
  summary_project: z.string().nullable(),
  projects: z.array(z.string()),
});
const ItemsSchema = z.array(ItemSchema).min(1).max(5);
const ArgsSchema = z.strictObject({
  query: z.string().min(1).max(KH_QUERY_TEXT_MAX),
  project: z.string().optional(),
});

/** `kh_jobs.items` + `runs.stage_run_id` ⇒ `ctx.kh`; thiếu/sai hình ⇒ null (không `kh-query`). */
export function khJobCtx(items: unknown, stageRunId: string | null): KhJobCtx | null {
  if (!stageRunId || items === null || items === undefined) return null;
  const p = ItemsSchema.safeParse(items);
  return p.success ? { items: p.data, stageRunId } : null;
}

const KH_TEXT = {
  KH_LIMIT: `Knowledge query limit reached for this stage (${KH_QUERY_LIMIT}). Continue without it.`,
  KH_UNAVAILABLE: "The knowledge base is unavailable. Continue without it.",
} as const;
const errText = (text: string): ToolResult => ({
  content: [{ type: "text", text }],
  isError: true,
});

type Call = {
  ctx: KhMcpCtx;
  item: KhJobItem;
  label: string;
  project: string;
  key: KhUsageKey;
};

export type KhQueryDeps = {
  db: Db;
  rt: KhRuntime;
  log: Pick<Logger, "warn">;
  audit?: HubAuditWriter;
};

export class KhQueryService {
  readonly #audit: HubAuditWriter;
  constructor(private readonly d: KhQueryDeps) {
    this.#audit = d.audit ?? dbHubAudit;
  }

  #has(ctx: KhMcpCtx): ctx is KhMcpCtx & { kh: KhJobCtx } {
    return ctx.kh !== null && ctx.tools.includes(KH_TOOL_KEY);
  }

  /** plan §3.4 bước 2 · `ctx.tools ∋ kh-query ∧ ctx.kh` ⇒ một tool. */
  tools(ctx: KhMcpCtx): McpToolDef[] {
    if (!this.#has(ctx)) return [];
    const { items } = ctx.kh;
    return [
      {
        name: KH_TOOL_KEY,
        description: khToolDescription(items),
        inputSchema: khToolInputSchema(items),
      },
    ];
  }

  /** Lời gọi thuộc `kh-query` của job này ⇒ bộ xử lý; khác ⇒ null (luồng workflow H2a, `-32602` nếu lạ). */
  accepts(
    ctx: KhMcpCtx,
    name: string | null | undefined,
  ): { call(args: unknown): Promise<ToolResult> } | null {
    if (name !== KH_TOOL_KEY || !this.#has(ctx)) return null;
    const kh = ctx.kh;
    return { call: (args) => this.call(ctx, kh, args) };
  }

  async call(ctx: KhMcpCtx, kh: KhJobCtx, raw: unknown): Promise<ToolResult> {
    const a = ArgsSchema.safeParse(raw ?? {});
    if (!a.success) return toolError("INVALID_ARGS");
    const r = khResolveProject(kh.items, a.data.project);
    if (!r.ok) return errText(`Pass project as one of: ${r.labels.join(", ")}.`);
    const item = kh.items.find((i) => i.connection_id === r.option.connectionId);
    if (!item) return errText(KH_TEXT.KH_UNAVAILABLE);
    const loaded = await withHubScope(this.d.db, { kind: "system" }, async (tx) => ({
      key: await usageKeyOf(tx, kh.stageRunId, ctx.tenantId),
      conn: await readConn(tx, item.connection_id),
    }));
    if (!loaded.key) return errText(KH_TEXT.KH_UNAVAILABLE);
    const c: Call = {
      ctx,
      item,
      label: r.option.label,
      project: r.option.project,
      key: loaded.key,
    };
    if (!loaded.conn || !this.#usable(loaded.conn)) {
      await this.#degrade(c, "disabled");
      return errText(KH_TEXT.KH_UNAVAILABLE);
    }
    const n = await withHubScope(this.d.db, { kind: "system" }, (tx) =>
      bumpKhUsage(tx, c.key, KH_QUERY_LIMIT),
    );
    if (n === null) return errText(KH_TEXT.KH_LIMIT);
    return this.#query(c, loaded.conn, a.data.query, n);
  }

  /** D3 · `check_status = ok` ∧ URL qua `khUrlPolicy` lúc gọi. */
  #usable(conn: KhConnRow): boolean {
    if (!khConnectionUsable(conn)) return false;
    return khUrlPolicy(conn.baseUrl, this.d.rt.cfg.allowedOrigins, { dev: this.d.rt.dev }).ok;
  }

  async #query(c: Call, row: KhConnRow, text: string, n: number): Promise<ToolResult> {
    const conn: KhConn = {
      id: row.id,
      baseUrl: row.baseUrl,
      secretId: row.secretId,
      version: row.version,
    };
    let body: unknown;
    try {
      body = await this.d.rt.client.query(conn, { text, project: c.project });
    } catch (err) {
      if (!isKhCallError(err))
        this.d.log.warn("kh-query-error", { connection_id: row.id, ...safeErrorFields(err) });
      const code = isKhCallError(err) ? err.code : "unreachable";
      await this.#degrade(c, code, isKhCallError(err) ? err.status : undefined);
      return errText(KH_TEXT.KH_UNAVAILABLE);
    }
    const packed = khPackHits(body);
    if (!packed) {
      await this.#degrade(c, "invalid");
      return errText(KH_TEXT.KH_UNAVAILABLE);
    }
    return {
      content: [{ type: "text", text: khToolText(packed.text) }],
      isError: false,
      structuredContent: {
        project: c.label,
        hits: packed.hits,
        used_chars: packed.used_chars,
        cut_at_budget: packed.cut_at_budget,
        calls_left: Math.max(0, KH_QUERY_LIMIT - n),
      },
    };
  }

  /** G9 · `last_warning` + audit `degrade` (plan §4) cùng tx; lỗi ghi ⇒ warn, vẫn trả KH_UNAVAILABLE. */
  async #degrade(c: Call, code: KhWarningCode, status?: number): Promise<void> {
    const http = status === undefined ? {} : { http_status: status };
    this.d.log.warn("kh-query-degraded", { connection_id: c.item.connection_id, code, ...http });
    const summary = { code, connection: c.item.name, stage_run_id: c.key.stageRunId, ...http };
    try {
      await withHubScope(this.d.db, { kind: "system" }, async (tx) => {
        await setKhWarning(tx, c.key, code);
        await this.#audit.insert(tx, {
          tenantId: c.ctx.tenantId,
          actorId: null,
          actorUsername: null,
          actorRole: null,
          action: "degrade",
          entity: "kh_query",
          entityId: c.key.processRunId,
          entityName: worklogSubject(c.key.processKey, c.key.stageKey),
          hubConfigVersion: null,
          before: null,
          after: null,
          summary,
        });
      });
    } catch (err) {
      this.d.log.warn("kh-degrade-write-failed", { run_id: c.ctx.runId, ...safeErrorFields(err) });
    }
  }
}
