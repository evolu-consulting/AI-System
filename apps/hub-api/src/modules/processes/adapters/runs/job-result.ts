// HUB-FR-106 · D5 · D11 · T7s · adapter: kết quả job agent (`JobOutcome` của runner) ⇒ `StageResult` cho máy trạng thái
// (xử lý job lỗi/huỷ/hết giờ tách khỏi driver). Thuần ánh xạ — không DB, không log nội dung.
import type { AgentResult, TokenUsage } from "@ai/contracts/hub";
import type { JobOutcome } from "../../../runner/job/job-agent-runner";
import { totalTokens } from "../../core/limits.rules";
import type { StageResult } from "../../runs/team-runner";

type Usage = { cache_read_tokens?: number; cache_write_tokens?: number } & TokenUsage;

export const tokensOf = (u: TokenUsage): number =>
  totalTokens({
    input: u.input_tokens,
    output: u.output_tokens,
    cacheRead: (u as Usage).cache_read_tokens ?? null,
    cacheWrite: (u as Usage).cache_write_tokens ?? null,
  });

export function resultOf(o: JobOutcome): StageResult {
  // D11 · `aborted` = AbortSignal (huỷ run stage `/runs/:id/cancel` hoặc tắt instance), không phải lỗi agent ⇒ interrupted.
  if (o.kind === "aborted") return { kind: "limit", reason: "interrupted" };
  if (o.kind === "failed")
    return { kind: "failed", reason: o.code === "TIMEOUT" ? "job_timeout" : "agent_failed" };
  const r = o.output.kind === "agent_result" ? (o.output.result as AgentResult) : null;
  if (!r) return { kind: "failed", reason: "agent_failed" };
  if (r.status === "need_input")
    return { kind: "need_input", question: r.question, choices: r.choices ?? [] };
  return {
    kind: "output",
    text: r.text,
    ...(o.kind === "result" && o.sourceReads ? { sourceReads: o.sourceReads } : {}),
  };
}

/** Kết quả một job agent của stage: `StageResult` + token + id job + mã lỗi job (cho quyết định tự-sửa). */
export type AgentOut = {
  result: StageResult;
  usage: number;
  jobId: string | null;
  jobReason: string | null;
};

/** `JobOutcome` ⇒ `AgentOut`: `aborted` ⇒ 0 token/không job; `failed` ⇒ giữ `reason ?? code` làm `jobReason`. */
export const agentOutOf = (o: JobOutcome): AgentOut => ({
  result: resultOf(o),
  usage: o.kind === "aborted" ? 0 : tokensOf(o.usage),
  jobId: o.kind === "aborted" ? null : o.jobId || null,
  jobReason: o.kind === "failed" ? (o.reason ?? o.code) : null,
});
