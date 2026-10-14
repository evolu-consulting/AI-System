// HUB-FR-129 · HUB-BR-30 · PC2-R11 · ADR-0011 #4 · Q2 · P-c2 · `POST /internal/jobs/:job_id/source-credential` (plan §6.3).
// Thứ tự: token job (sai/thiếu/dạng sai/job khác ⇒ 401 MỘT thân) → `credentialJobAllows` (không running / sai loại / nguồn
// ngoài job ⇒ 404) → nguồn hiện tại cùng tenant job + có khoá (không ⇒ 404 cùng thân, tránh dò) → `useSecret` giải mã
// `source_credential` (NGOẠI LỆ có chủ đích: giá trị rời Hub tới Runtime, Q2) → 200 {username, token}. Khoá mất/giải mã hỏng
// ⇒ 409. KHÔNG log giá trị token (chỉ `{job_id, source_id}`); token chỉ trong body (route gắn `no-store`).
import type { SourceConfig } from "@ai/contracts/hub-admin";
import { gitProviderOf } from "@ai/contracts/hub-admin";
import type { SourceCredentialResponse } from "@ai/contracts/hub-internal";
import { withHubScope } from "@ai/db/hub-scope";
import type { Db } from "../../lib/db";
import { hashJobToken } from "../../lib/job-token";
import type { Logger } from "../../lib/logger";
import {
  type CredentialJobShape,
  credentialJobAllows,
  credentialUsername,
} from "../processes/runs/apply.rules";
import { type HubSecretReader, isSecretUseError } from "../secrets/secrets.use";
import { bearerJobToken } from "./credential.service";
import * as repo from "./source-credential.repo";

export type SourceCredentialResult =
  | { kind: "ok"; body: SourceCredentialResponse }
  | { kind: "unauthorized" }
  | { kind: "not_found" }
  | { kind: "not_configured" };

export type SourceCredentialDeps = {
  db: Db;
  reader: Pick<HubSecretReader, "useSecret">;
  log: Pick<Logger, "warn" | "info">;
};

const UNAUTHORIZED = { kind: "unauthorized" } as const;
const NOT_FOUND = { kind: "not_found" } as const;
const NOT_CONFIGURED = { kind: "not_configured" } as const;

type RawPayload = {
  source?: { source_id?: unknown } | null;
  items?: { source_id?: unknown }[] | null;
} | null;

/** Hình job (type/status/nguồn) từ payload jsonb, lọc source_id dạng chuỗi. */
function jobShape(job: repo.CredentialJob): CredentialJobShape {
  const p = (job.payload ?? null) as RawPayload;
  const sid = p?.source?.source_id;
  const items = Array.isArray(p?.items)
    ? p.items
        .filter((i): i is { source_id: string } => typeof i?.source_id === "string")
        .map((i) => ({ source_id: i.source_id }))
    : null;
  return {
    type: job.type,
    status: job.status,
    source: typeof sid === "string" ? { source_id: sid } : null,
    items,
  };
}

/** `credential_secret_id` của nguồn git có khoá; không git / không khoá ⇒ null. */
function gitRemoteCredential(config: SourceConfig | undefined): string | null {
  return config?.kind === "git_remote" ? (config.credential_secret_id ?? null) : null;
}

type Allowed = { tenantId: string; secretId: string; url: string };

export class SourceCredentialService {
  constructor(private readonly d: SourceCredentialDeps) {}

  async issue(
    authorization: string | undefined,
    jobId: string,
    sourceId: string,
  ): Promise<SourceCredentialResult> {
    const token = bearerJobToken(authorization);
    if (!token) return UNAUTHORIZED;
    const hash = hashJobToken(token);
    const a = await this.allow(hash, jobId, sourceId);
    if (!("tenantId" in a)) return a;
    let value: string;
    try {
      value = await this.d.reader.useSecret(
        { id: a.secretId, kind: "source_credential", tenantId: a.tenantId },
        (v) => Promise.resolve(v),
      );
    } catch (err) {
      if (isSecretUseError(err)) return NOT_CONFIGURED;
      throw err;
    }
    if (value === "") return NOT_CONFIGURED;
    this.d.log.info("source-credential-issued", { job_id: jobId, source_id: sourceId });
    return {
      kind: "ok",
      body: { username: credentialUsername(gitProviderOf(a.url)), token: value },
    };
  }

  /** Token→job (một tx đọc, scope system): sai token/job khác ⇒ 401; sai điều kiện/nguồn ⇒ 404; hợp lệ ⇒ `Allowed`. */
  private allow(
    hash: Buffer,
    jobId: string,
    sourceId: string,
  ): Promise<Allowed | typeof UNAUTHORIZED | typeof NOT_FOUND> {
    return withHubScope(this.d.db, { kind: "system" }, async (tx) => {
      const job = await repo.jobByTokenHash(tx, hash);
      if (!job || job.id !== jobId) return UNAUTHORIZED;
      if (!credentialJobAllows(jobShape(job), sourceId)) return NOT_FOUND;
      const config = await repo.sourceConfigById(tx, job.tenantId, sourceId);
      const secretId = gitRemoteCredential(config);
      if (secretId === null || config === undefined) return NOT_FOUND;
      return {
        tenantId: job.tenantId,
        secretId,
        url: config.kind === "git_remote" ? config.url : "",
      };
    });
  }
}
