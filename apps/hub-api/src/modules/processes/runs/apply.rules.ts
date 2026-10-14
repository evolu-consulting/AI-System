// HUB-FR-129 · HUB-FR-130 · HUB-BR-30 · PC2-R11 · P-c2 · luật thuần Áp (plan §4 Hub) — không I/O, dễ test.
// B4: chỉ `credentialUsername` + `credentialJobAllows` (kênh giao khoá nguồn). B5+ mở rộng (applyPlan/applyOutcome/…).
import type { GitProvider } from "@ai/contracts/hub-admin";

/** PC2-R11 · username git theo provider: `github` ⇒ `x-access-token`; host khác / null ⇒ `oauth2`. */
export function credentialUsername(provider: GitProvider | null): string {
  return provider === "github" ? "x-access-token" : "oauth2";
}

/** Hình job tối thiểu để xét quyền giao khoá (payload đã đọc từ `hub.jobs`). */
export type CredentialJobShape = {
  type: string;
  status: string;
  source?: { source_id: string } | null;
  items?: readonly { source_id: string }[] | null;
};

/**
 * PC2-R11 · chỉ cho giao khoá khi job `running` và `source_id` thuộc job:
 * `source.apply` ⇒ nguồn = `payload.source`; `source.resolve` ⇒ nguồn ∈ `payload.items`. Loại khác / không running ⇒ false.
 * KHÔNG xét tồn tại khoá / cùng tenant ở đây (service đọc nguồn hiện tại theo tenant của job).
 */
export function credentialJobAllows(job: CredentialJobShape, sourceId: string): boolean {
  if (job.status !== "running") return false;
  if (job.type === "source.apply") return job.source?.source_id === sourceId;
  if (job.type === "source.resolve") return (job.items ?? []).some((i) => i.source_id === sourceId);
  return false;
}
