// dlc-dify · chạy MỘT hook: tra workflow trong catalog Admin (bật, loại `workflow`) → app-key (`CredentialService`) →
// Dify blocking-gom qua `DifyClient.runStreaming` trong hạn → chữ kết quả (`output_field` của workflow, vắng = `text`).
// Không ném: lỗi / hết hạn / workflow mất ⇒ `null` + log cảnh báo (hook không làm hỏng run). Không log input (có token).
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { Db } from "../../lib/db";
import type { Logger } from "../../lib/logger";
import type { CatalogSnapshot } from "../config/catalog.rules";
import type { CredentialService } from "../dify/credential.service";
import type { DifyClient } from "../dify/dify.client";
import { type HookInputs, pickInputs } from "./hooks.rules";

export type HookRow = { event: string; workflowId: string };

export type HookRunnerDeps = {
  db: Db;
  catalog: () => Promise<CatalogSnapshot>;
  credentials: Pick<CredentialService, "apiKey">;
  dify: Pick<DifyClient, "runStreaming">;
  log: Logger;
};

const CACHE_MS = 15_000;

export class HookRunner {
  readonly #cache = new Map<string, { at: number; rows: HookRow[] }>();

  constructor(private readonly d: HookRunnerDeps) {}

  /** Hook của agent (scope `system`, cache 15 s — đổi ở Studio thấy sau ≤ 15 s). */
  async hooksOf(agentId: string): Promise<HookRow[]> {
    const hit = this.#cache.get(agentId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows;
    const rows = await withHubScope(this.d.db, { kind: "system" }, (tx) =>
      tx.execute<HookRow>(sql`select event, workflow_id as "workflowId"
        from hub.agent_hooks where agent_id = ${agentId}::uuid`),
    );
    this.#cache.set(agentId, { at: Date.now(), rows: [...rows] });
    return [...rows];
  }

  /** Workflow hook dùng được (bật, loại `workflow`) + app-key; không ⇒ null + log cảnh báo. */
  async #target(workflowId: string, inputs: HookInputs, log: Logger) {
    const w = (await this.d.catalog()).workflows.get(workflowId);
    if (!w?.enabled || w.appType !== "workflow") {
      log.warn("hook-workflow-unavailable", {
        hook: inputs.event,
        agent: inputs.agent_key,
        workflow_id: workflowId,
      });
      return null;
    }
    try {
      return { w, apiKey: await this.d.credentials.apiKey(workflowId) };
    } catch {
      log.warn("hook-workflow-no-key", { workflow_id: workflowId });
      return null;
    }
  }

  async run(workflowId: string, inputs: HookInputs, timeoutMs: number): Promise<string | null> {
    const log = this.d.log.child({ run_id: inputs.run_id });
    const t = await this.#target(workflowId, inputs, log);
    if (!t) return null;
    const { w, apiKey } = t;
    const signal = AbortSignal.timeout(timeoutMs);
    const o = await this.d.dify.runStreaming(
      {
        appType: "workflow",
        baseUrl: w.baseUrl,
        apiKey,
        inputs: pickInputs(inputs, w.inputSchema),
        query: null,
        user: `hub-hook:${inputs.user_id}`,
        conversationId: null,
        outputField: w.outputField,
      },
      signal,
      () => {},
    );
    if (o.kind === "finished") {
      log.info("hook-ran", {
        hook: inputs.event,
        agent: inputs.agent_key,
        workflow: w.key,
        ms: o.ms,
        chars: o.text.length,
      });
      return o.text;
    }
    // Hook không có gì để thêm ⇒ workflow trả `text` rỗng (DifyClient coi là `invalid_output`): không phải lỗi.
    if (o.kind === "failed" && o.reason === "invalid_output" && o.httpStatus === null) {
      log.info("hook-ran", {
        hook: inputs.event,
        agent: inputs.agent_key,
        workflow: w.key,
        ms: o.ms,
        chars: 0,
      });
      return "";
    }
    log.warn("hook-failed", {
      hook: inputs.event,
      agent: inputs.agent_key,
      workflow: w.key,
      outcome: o.kind,
      ...(o.kind === "failed" ? { code: o.code, status: o.httpStatus } : {}),
    });
    return null;
  }
}
