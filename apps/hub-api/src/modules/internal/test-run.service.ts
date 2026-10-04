// HUB-FR-51 · HUB-H2a-AC-08 · H2a-R24, R05–R11, R15, R17 · Q13, Q16 · chạy thử command nháp (Admin M5) theo đường sync
// (plan §2.3–2.4): workflow từ cache catalog (không có → 409) → gán tham số/`inputs` như E12 (`bindCommandInputs`, 422) →
// app-key ngay trước khi gọi (R17; thiếu/hỏng → 409) → Dify streaming trong hạn `timeout_s` (hết → client stop →
// `TIMEOUT`). **Không** kiểm quyền feature, **không** ghi conversation/run/message/usage/job (Q13: usage trả trong body).
// Lỗi Dify → 200 `ok:false` + `detail` ≤ 300 đã che key (Q16). Không log app-key / `inputs`.

import type { ChatRunErrorCode } from "@ai/contracts/chat";
import {
  TEST_RUN_OUTPUT_MAX,
  type TestRunRequest,
  type TestRunResponse,
} from "@ai/contracts/hub-internal";
import { validationError } from "../../lib/http";
import type { Logger } from "../../lib/logger";
import type { CatalogWorkflow } from "../commands/catalog.types";
import { type BoundCommand, bindCommandInputs } from "../commands/commands.service";
import type { UserState } from "../config/config.rules";
import type { ConfigCache } from "../config/config.service";
import { stepLabel } from "../conversations/conversations.rules";
import { type CredentialService, isCredentialError } from "../dify/credential.service";
import type { DifyClient, DifyRunOutcome } from "../dify/dify.client";
import { difyUser, maskSecret } from "../dify/dify.rules";
import { runErrorText } from "../runs/run-errors";
import { internalError } from "./test-run.errors";

export type TestRunDeps = {
  config: Pick<ConfigCache, "catalog" | "user" | "poll">;
  credentials: Pick<CredentialService, "apiKey">;
  dify: Pick<DifyClient, "runStreaming">;
  log: Logger;
  /** = `HUB_DIFY_TIMEOUT_MAX_S`: trần `timeout_s` nháp. */
  timeoutMaxS: number;
};

/** Đã qua kiểm đầu vào: đủ để gọi Dify. */
type Ready = {
  workflow: CatalogWorkflow;
  user: UserState;
  tenantKey: string;
  bound: BoundCommand;
  outputField: string;
  timeoutS: number;
};

type Failure = { code: ChatRunErrorCode; detail: string | null };

/** Lỗi theo plan-errors §2; `aborted` chỉ do hết hạn (test-run không có huỷ từ người dùng). Che key lần nữa (Q16). */
function failureOf(res: Exclude<DifyRunOutcome, { kind: "finished" }>, apiKey: string): Failure {
  if (res.kind === "aborted") return { code: "TIMEOUT", detail: null };
  return { code: res.code, detail: res.detail === null ? null : maskSecret(res.detail, apiKey) };
}

export class TestRunService {
  constructor(private readonly d: TestRunDeps) {}

  async run(req: TestRunRequest): Promise<TestRunResponse> {
    const r = await this.prepare(req);
    let apiKey: string;
    try {
      apiKey = await this.d.credentials.apiKey(r.workflow.id);
    } catch (err) {
      if (isCredentialError(err)) throw internalError("NOT_CONFIGURED");
      throw err;
    }
    return this.call(r, apiKey);
  }

  /** Workflow (trượt → `poll` rồi tra lại, như E12) + actor + gán tham số. Không ghi gì. */
  private async prepare(req: TestRunRequest): Promise<Ready> {
    const { command } = req;
    let catalog = await this.d.config.catalog();
    if (!catalog.workflows.has(command.workflow_id)) {
      await this.d.config.poll();
      catalog = await this.d.config.catalog();
    }
    const workflow = catalog.workflows.get(command.workflow_id);
    if (!workflow) throw internalError("NOT_CONFIGURED");
    const user = await this.d.config.user(req.actor_user_id);
    if (!user)
      throw validationError([
        { path: ["actor_user_id"], code: "not_found", message: "Unknown user" },
      ]);
    const bound = bindCommandInputs({
      command: { args: command.args, inputMap: command.input_map },
      workflow,
      rest: req.text,
      ctx: req.context ?? {},
      userId: user.id,
      tenantId: user.tenantId,
    });
    return {
      workflow,
      user,
      tenantKey: catalog.tenantKeys.get(user.tenantId) ?? user.tenantId,
      bound,
      outputField: command.output.field,
      timeoutS: Math.min(command.timeout_s, this.d.timeoutMaxS),
    };
  }

  private async call(r: Ready, apiKey: string): Promise<TestRunResponse> {
    const t0 = performance.now();
    const res = await this.d.dify.runStreaming(
      {
        appType: r.workflow.appType,
        baseUrl: r.workflow.baseUrl,
        apiKey,
        inputs: r.bound.inputs,
        query: r.bound.query,
        user: difyUser(r.tenantKey, r.user.id),
        conversationId: null,
        outputField: r.outputField,
      },
      AbortSignal.timeout(r.timeoutS * 1000),
      () => {},
    );
    const ms = Math.round(performance.now() - t0);
    const label = stepLabel("workflow", r.user.locale);
    const tail = (status: "ok" | "failed") => ({
      steps: [{ label, status, ms: Math.max(0, res.ms) }],
      usage: res.usage,
      ms,
    });
    if (res.kind === "finished") {
      this.logRun(r, null, ms);
      return { ok: true, output: res.text.slice(0, TEST_RUN_OUTPUT_MAX), ...tail("ok") };
    }
    const f = failureOf(res, apiKey);
    this.logRun(r, f.code, ms);
    const message = runErrorText(f.code, r.user.locale).message;
    return { ok: false, error: { ...f, message }, ...tail("failed") };
  }

  private logRun(r: Ready, code: ChatRunErrorCode | null, ms: number): void {
    this.d.log.info("test-run", { workflow_id: r.workflow.id, code, ms });
  }
}
