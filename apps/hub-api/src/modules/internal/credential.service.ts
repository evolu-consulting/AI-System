// WRK-FR-07, HUB-FR-89 · H2a-R08, R17 · Q5 · `POST /internal/jobs/:job_id/dify-credential` (plan H2a §2.3–2.4): token job
// (Bearer, 43 ký tự base64url) → `hashJobToken` → job `workflow.async` `running` có đúng `id` → `{base_url, api_key, app_type}`
// hiện hành của workflow trong payload. Mọi sai (thiếu/sai token, job khác, không `running`, không `workflow.async`, payload
// hỏng) → cùng `unauthorized`. Secret thiếu/giải mã lỗi/master key vắng, workflow không có trong catalog → `not_configured`.
// **Không** xét `workflows.enabled` (job đã nhận chạy tới cùng, R08). Không log token/key.

import { WorkflowAsyncJobSchema } from "@ai/contracts/hub";
import {
  type DifyCredentialResponse,
  DifyCredentialResponseSchema,
} from "@ai/contracts/hub-internal";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { Db } from "../../lib/db";
import { hashJobToken, isJobToken } from "../../lib/job-token";
import type { Logger } from "../../lib/logger";
import type { CatalogSnapshot } from "../config/catalog.rules";
import { type CredentialService, isCredentialError } from "../dify/credential.service";
import * as repo from "./credential.repo";

export type DifyCredentialResult =
  | { kind: "ok"; body: DifyCredentialResponse }
  | { kind: "unauthorized" }
  | { kind: "not_configured" };

export type DifyCredentialServiceDeps = {
  db: Db;
  catalog: () => Promise<CatalogSnapshot>;
  credentials: Pick<CredentialService, "apiKey">;
  log: Logger;
};

const BEARER_RE = /^Bearer[ \t]+(\S+)[ \t]*$/i;
const UNAUTHORIZED = { kind: "unauthorized" } as const;
const NOT_CONFIGURED = { kind: "not_configured" } as const;

/** Token job trong header `Authorization` (đúng hình 43 ký tự base64url) hoặc null. */
export function bearerJobToken(authorization: string | undefined): string | null {
  const t = authorization === undefined ? undefined : BEARER_RE.exec(authorization)?.[1];
  return t !== undefined && isJobToken(t) ? t : null;
}

export class DifyCredentialService {
  constructor(private readonly d: DifyCredentialServiceDeps) {}

  async issue(authorization: string | undefined, jobId: string): Promise<DifyCredentialResult> {
    const token = bearerJobToken(authorization);
    if (!token) return UNAUTHORIZED;
    const hash = hashJobToken(token);
    const job = await withHubScope(this.d.db, { kind: "system" }, (tx: Tx) =>
      repo.jobByTokenHash(tx, hash),
    );
    if (!job || job.id !== jobId || job.type !== "workflow.async") return UNAUTHORIZED;
    const payload = WorkflowAsyncJobSchema.safeParse(job.payload);
    if (!payload.success) return UNAUTHORIZED;
    const workflowId = payload.data.workflow_id;
    const wf = (await this.d.catalog()).workflows.get(workflowId);
    if (!wf) {
      this.d.log.warn("dify-credential-workflow-missing", {
        job_id: jobId,
        workflow_id: workflowId,
      });
      return NOT_CONFIGURED;
    }
    let apiKey: string;
    try {
      apiKey = await this.d.credentials.apiKey(workflowId);
    } catch (err) {
      if (!isCredentialError(err)) throw err;
      return NOT_CONFIGURED;
    }
    const body = DifyCredentialResponseSchema.safeParse({
      base_url: wf.baseUrl,
      api_key: apiKey,
      app_type: wf.appType,
    });
    if (!body.success) {
      this.d.log.warn("dify-credential-invalid", { job_id: jobId, workflow_id: workflowId });
      return NOT_CONFIGURED;
    }
    this.d.log.info("dify-credential-issued", { job_id: jobId, workflow_id: workflowId });
    return { kind: "ok", body: body.data };
  }
}
