// HUB-FR-129 · HUB-FR-130 · HUB-BR-30 · PC2-R11 · P-c2 · luật thuần Áp (plan §4 Hub) — không I/O, dễ test.
// B4: `credentialUsername` + `credentialJobAllows`. B6: applyPlan/applyOutcome/githubRepoOf/mapProviderError/
// prTitle/prBody/prUrlOk/applyOutputMd/redactSecrets (dùng ở launcher/driver/github-client — PC2-R03,R07–R09,R14,R15).

import type { JobAttachment } from "@ai/contracts/hub";
import type {
  ApplyErrorCode,
  ApplyMode,
  ApplyStatus,
  AutofixStatus,
  GitProvider,
  SourceKind,
} from "@ai/contracts/hub-admin";

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

// ── B6 · plan §4 Hub ─────────────────────────────────────────────────────────

/** Kết quả stage tự-sửa bước trước (bản người vừa Đạt). */
export type ApplyPlanResult = { status: AutofixStatus; diff: JobAttachment | null } | null;
export type ApplyPlan =
  | { kind: "no_changes" }
  | { kind: "branch_only" }
  | { kind: "job"; pushOnly: boolean }
  | { kind: "invalid" };

/**
 * PC2-R03 · từ kết quả tự-sửa + loại nguồn + chế độ ⇒ kế hoạch Áp:
 * thiếu kết quả / `check_failed` / `ok` thiếu diff ⇒ `invalid`; `no_changes` ⇒ `no_changes`;
 * `local_path` ⇒ `branch_only`; `git_remote` ⇒ `job` (`pushOnly = mode==="branch_only"`).
 */
export function applyPlan(i: {
  result: ApplyPlanResult;
  sourceKind: SourceKind;
  mode: ApplyMode;
}): ApplyPlan {
  const r = i.result;
  if (!r) return { kind: "invalid" };
  if (r.status === "no_changes") return { kind: "no_changes" };
  if (r.status !== "ok" || !r.diff) return { kind: "invalid" };
  if (i.sourceKind === "local_path") return { kind: "branch_only" };
  return { kind: "job", pushOnly: i.mode === "branch_only" };
}

export type ApplyOutcome =
  | { kind: "provider" }
  | { kind: "done" }
  | {
      kind: "decision";
      reason: "apply_conflict" | "apply_failed" | "sandbox_unavailable";
      code: ApplyErrorCode | null;
    };

/**
 * PC2-R08 · thứ tự: job lỗi `container` ⇒ `sandbox_unavailable`; thiếu báo cáo ⇒ `apply_failed{provider_error}`;
 * có báo cáo (bỏ qua jobReason khác `container`, C37): `conflict` ⇒ `apply_conflict`; `check_failed` ⇒
 * `apply_failed{check_failed}`; `failed` ⇒ `apply_failed{code??provider_error}`; `pushed` ⇒ `provider` nếu
 * `!pushOnly`, ngược lại `done`.
 */
export function applyOutcome(
  r: { status: ApplyStatus; code: ApplyErrorCode | null } | null,
  jobReason: string | null,
  pushOnly: boolean,
): ApplyOutcome {
  if (jobReason === "container")
    return { kind: "decision", reason: "sandbox_unavailable", code: "provider_error" };
  if (!r) return { kind: "decision", reason: "apply_failed", code: "provider_error" };
  if (r.status === "conflict") return { kind: "decision", reason: "apply_conflict", code: null };
  if (r.status === "check_failed")
    return { kind: "decision", reason: "apply_failed", code: "check_failed" };
  if (r.status === "failed")
    return { kind: "decision", reason: "apply_failed", code: r.code ?? "provider_error" };
  return pushOnly ? { kind: "done" } : { kind: "provider" };
}

const REPO_SEG = /^[A-Za-z0-9_.-]{1,100}$/;

/** PC2-R07 · `<owner>/<repo>[.git]` từ URL; owner/repo `[A-Za-z0-9_.-]{1,100}`; hình khác / URL hỏng ⇒ null. */
export function githubRepoOf(url: string): { owner: string; repo: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const parts = parsed.pathname.replace(/^\/+/, "").split("/");
  const [owner, rawRepo] = parts;
  if (parts.length !== 2 || owner === undefined || rawRepo === undefined) return null;
  const repo = rawRepo.endsWith(".git") ? rawRepo.slice(0, -4) : rawRepo;
  if (!REPO_SEG.test(owner) || !REPO_SEG.test(repo)) return null;
  return { owner, repo };
}

export type ProviderErrorInput = {
  status: number;
  retryAfter: string | null;
  rateRemaining: string | null;
  rateReset: string | null;
  nowMs: number;
  body422AlreadyExists: boolean;
};
export type ProviderErrorResult =
  | { kind: "exists" }
  | { kind: "retry"; waitMs: number }
  | { kind: "fail"; code: ApplyErrorCode };

const RATE_LIMIT_MAX_WAIT_MS = 60_000;

/** Chờ (ms) theo `retry-after` (giây) ưu tiên, rồi `x-ratelimit-reset` (epoch giây); không có ⇒ NaN. */
function rateWaitMs(i: ProviderErrorInput): number {
  if (i.retryAfter != null) return Math.round(Number.parseFloat(i.retryAfter) * 1000);
  if (i.rateReset != null) return Math.round(Number.parseFloat(i.rateReset) * 1000 - i.nowMs);
  return Number.NaN;
}

/**
 * PC2-R09 · ánh xạ phản hồi lỗi provider: 401 ⇒ auth; 403 ratelimit-remaining 0 / 429 ⇒ chờ ≤ 60 s thì `retry`,
 * ngược lại `rate_limited`; 403/404 khác ⇒ auth; 422 "already exists" ⇒ `exists`, 422 khác ⇒ provider_error;
 * 5xx ⇒ `retry{0}` (client tự lùi 1/2/4 s); còn lại ⇒ provider_error.
 */
export function mapProviderError(i: ProviderErrorInput): ProviderErrorResult {
  if (i.status === 401) return { kind: "fail", code: "auth" };
  const isRate = i.status === 429 || (i.status === 403 && i.rateRemaining === "0");
  if (isRate) {
    const waitMs = rateWaitMs(i);
    if (Number.isFinite(waitMs) && waitMs >= 0 && waitMs <= RATE_LIMIT_MAX_WAIT_MS)
      return { kind: "retry", waitMs };
    return { kind: "fail", code: "rate_limited" };
  }
  if (i.status === 403 || i.status === 404) return { kind: "fail", code: "auth" };
  if (i.status === 422)
    return i.body422AlreadyExists ? { kind: "exists" } : { kind: "fail", code: "provider_error" };
  if (i.status >= 500) return { kind: "retry", waitMs: 0 };
  return { kind: "fail", code: "provider_error" };
}

const PR_TITLE_MAX = 256;

/** PC2-R14 · `[AI] <quy trình> · <stage> (<8 ký tự run>)`, ≤ 256 — cắt tên quy trình trước. */
export function prTitle(processName: string, stageName: string, runId: string): string {
  const suffix = ` · ${stageName} (${runId.slice(0, 8)})`;
  const prefix = "[AI] ";
  const full = `${prefix}${processName}${suffix}`;
  if (full.length <= PR_TITLE_MAX) return full;
  const room = Math.max(0, PR_TITLE_MAX - prefix.length - suffix.length);
  return `${prefix}${processName.slice(0, room)}${suffix}`;
}

const PR_BODY_MAX = 8_000;
const PR_SECTIONS = new Set(["Thay đổi", "Test"]);
const H2 = /^##[ \t]+(.+?)[ \t]*$/;

/**
 * PC2-R14 · thân PR = mục `## Thay đổi` + `## Test` của output tự-sửa (che bí mật, ≤ 8000) + chân
 * `Tạo bởi AI System · run <id> · vòng <k>`. Không mục khác, không đầu vào người dùng khác.
 */
export function prBody(output: string | null, runId: string, round: number): string {
  const footer = `Tạo bởi AI System · run ${runId} · vòng ${round}`;
  const picked: string[] = [];
  let keep = false;
  for (const line of (output ?? "").split("\n")) {
    const m = line.match(H2);
    if (m) {
      keep = PR_SECTIONS.has(m[1] ?? "");
      if (keep) picked.push(line);
      continue;
    }
    if (keep) picked.push(line);
  }
  let content = redactSecrets(picked.join("\n").trim());
  if (content.length > PR_BODY_MAX) content = content.slice(0, PR_BODY_MAX);
  return content ? `${content}\n\n${footer}` : footer;
}

/** PC2-R15 · `pr_url` hợp lệ chỉ khi `https://` và host = `webHost`. */
export function prUrlOk(url: string, webHost: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.host === webHost;
  } catch {
    return false;
  }
}

export type ApplyOutputInput = {
  mode: ApplyMode;
  status: ApplyStatus;
  branch: string | null;
  head_sha: string | null;
  target_sha: string | null;
  rebased: boolean;
  pr_url: string | null;
  pr_number: number | null;
  auto_merge: "on" | "failed" | null;
};

function prOpenedLines(r: ApplyOutputInput): string[] {
  const out = [`- PR: ${r.pr_url ?? "(đã mở)"}${r.pr_number != null ? ` (#${r.pr_number})` : ""}`];
  if (r.branch) out.push(`- Nhánh: \`${r.branch}\``);
  if (r.head_sha) out.push(`- Commit: \`${r.head_sha.slice(0, 7)}\``);
  if (r.rebased && r.target_sha) out.push(`- Đã rebase lên \`${r.target_sha.slice(0, 7)}\``);
  if (r.auto_merge === "on") out.push("- Auto-merge: đã bật (SQUASH)");
  else if (r.auto_merge === "failed") out.push("- Auto-merge: không bật được (PR vẫn mở)");
  return out;
}

function applyStatusLines(r: ApplyOutputInput): string[] {
  switch (r.status) {
    case "pr_opened":
      return prOpenedLines(r);
    case "pushed": {
      const out: string[] = [];
      if (r.branch) out.push(`- Đã đẩy nhánh \`${r.branch}\`.`);
      if (r.head_sha) out.push(`- Commit: \`${r.head_sha.slice(0, 7)}\``);
      return out;
    }
    case "branch_only":
      return [
        "Chế độ chỉ-nhánh: tải tệp `.diff` đính kèm rồi áp cục bộ:",
        "```sh\ngit apply changes.diff\n```",
      ];
    case "no_changes":
      return ["Không có thay đổi để áp."];
    default:
      return ["Áp không thành công — xem quyết định đi kèm."];
  }
}

/** HUB-FR-130 · Markdown output stage Áp (`## Kết quả áp`) — không đường dẫn máy. */
export function applyOutputMd(r: ApplyOutputInput): string {
  return `## Kết quả áp\n\n${applyStatusLines(r).join("\n")}\n`;
}

const REDACTED = "[REDACTED]";
// Mẫu bí mật — bản TS của `agent_runtime/autofix/rules.py` SECRET_RULES (PC-R08/PC-R12); khối PEM trước.
const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /AKIA[0-9A-Z]{16}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|PuTTY-User-Key-File-\d+:/g,
  /gh[pousr]_[A-Za-z0-9]{36,}/g,
  /github_pat_[A-Za-z0-9_]{60,}/g,
  /glpat-[A-Za-z0-9_-]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  /sk-[A-Za-z0-9]{32,}/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*['"][^'"\s]{12,}['"]/gi,
];

/** Che mọi khớp mẫu bí mật bằng `[REDACTED]` (dùng cho thân PR + `detail` provider). */
export function redactSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, REDACTED);
  return out;
}
