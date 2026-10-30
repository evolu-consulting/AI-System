// dlc-dify · `AgentRunner` bọc runner thật (RoutingRunner) để agent có hook như Claude CLI, không đổi người gọi
// (direct `@agent`, Orchestrator delegate, stage quy trình đều đi qua `agentRunner()`):
//   - trước job: `SessionStart` (lần đầu agent này chạy trong flow — nhớ trong tiến trình) + `UserPromptSubmit` (mỗi lượt)
//     ⇒ chữ trả về ghép vào lời nhắc hệ thống (`<hook-context>`), như `additionalContext` của Claude;
//   - sau `job.result`: `Stop` chạy nền với câu trả lời cuối (ghi worklog KH...), không chờ.
// Agent không có hook ⇒ chuyển thẳng, không I/O thêm ngoài một câu đọc (cache 15 s). Vai `orchestrator` không chạy hook.
// PreToolUse/PostToolUse chạy phía Runtime (gọi ngược Hub) — xem `hook-call.routes.ts`.
import { type RunEvent, SYSTEM_PROMPT_MAX } from "@ai/contracts/hub";
import type { AgentHookEvent } from "@ai/contracts/studio";
import type { Logger } from "../../lib/logger";
import type { AgentRunner, AgentTask } from "../runner/job/job-agent-runner";
import type { HookRow, HookRunner } from "./hook-runner";
import { HOOK_TIMEOUT_MS, type HookInputs, personaProjectOf, withHookContext } from "./hooks.rules";
import type { UserTokens } from "./user-token";

const SESSION_MAX = 5_000;

export type HookedRunnerDeps = { hooks: HookRunner; tokens: UserTokens; log: Logger };

function resultText(ev: RunEvent): string | null {
  if (ev.type !== "job.result") return null;
  const out = ev.output as { kind?: string; result?: { text?: unknown; question?: unknown } };
  if (out?.kind !== "agent_result") return null;
  const t = out.result?.text ?? out.result?.question;
  return typeof t === "string" ? t : "";
}

export class HookedRunner implements AgentRunner {
  /** `${agentId}:${flowId}` đã chạy SessionStart (tiến trình này). */
  readonly #sessions = new Set<string>();

  constructor(
    private readonly inner: AgentRunner,
    private readonly d: HookedRunnerDeps,
  ) {}

  async *run(task: AgentTask, signal: AbortSignal): AsyncIterable<RunEvent> {
    const rows = task.role === "agent" ? await this.#rows(task) : [];
    if (rows.length === 0) {
      yield* this.inner.run(task, signal);
      return;
    }
    const by = new Map(rows.map((r) => [r.event as AgentHookEvent, r.workflowId]));
    const base = await this.#inputs(task);
    const pre = await this.#pre(task, by, base);
    const hooked = pre ? { ...task, systemPrompt: pre } : task;
    const stop = by.get("Stop");
    for await (const ev of this.inner.run(hooked, signal)) {
      // Stop chạy nền NGAY khi có `job.result` (trước `yield`): người đọc (`runJob`) dừng vòng lặp sau sự kiện kết thúc,
      // nên mã sau vòng `for await` có thể không bao giờ chạy.
      const t = resultText(ev);
      if (stop && t !== null && !signal.aborted)
        void this.d.hooks
          .run(stop, { ...base, event: "Stop", last_answer: t }, HOOK_TIMEOUT_MS.post)
          .catch(() => {});
      yield ev;
    }
  }

  async #rows(task: AgentTask): Promise<HookRow[]> {
    try {
      return await this.d.hooks.hooksOf(task.agent.id);
    } catch (err) {
      this.d.log.warn("hooks-load-failed", { agent: task.agent.key, error: (err as Error).name });
      return [];
    }
  }

  async #inputs(task: AgentTask): Promise<HookInputs> {
    const r = task.run;
    const token = await this.d.tokens.forUser(r.tenantId, r.userId);
    return {
      event: "UserPromptSubmit",
      agent_key: task.agent.key,
      persona_project: personaProjectOf(task.agent.key, task.agent.runtimeOptions),
      user_token: token ?? "",
      actor: `flow-${r.flowId}`,
      tenant_id: r.tenantId,
      user_id: r.userId,
      run_id: r.id,
      conversation_id: r.conversationId,
      prompt: task.prompt,
    };
  }

  /** SessionStart (lần đầu trong flow) + UserPromptSubmit song song; trả lời nhắc mới hoặc null nếu không có chữ nào. */
  async #pre(
    task: AgentTask,
    by: Map<AgentHookEvent, string>,
    base: HookInputs,
  ): Promise<string | null> {
    const key = `${task.agent.id}:${task.run.flowId}`;
    const jobs: Promise<{ event: string; text: string }>[] = [];
    const start = by.get("SessionStart");
    if (start && !this.#sessions.has(key)) {
      if (this.#sessions.size >= SESSION_MAX) this.#sessions.clear();
      this.#sessions.add(key);
      jobs.push(this.#one(start, { ...base, event: "SessionStart" }));
    }
    const submit = by.get("UserPromptSubmit");
    if (submit) jobs.push(this.#one(submit, { ...base, event: "UserPromptSubmit" }));
    if (jobs.length === 0) return null;
    const parts = await Promise.all(jobs);
    const sp = task.systemPrompt ?? task.agent.systemPrompt;
    const next = withHookContext(sp, parts, SYSTEM_PROMPT_MAX);
    return next === sp ? null : next;
  }

  async #one(workflowId: string, inputs: HookInputs): Promise<{ event: string; text: string }> {
    const text = await this.d.hooks.run(workflowId, inputs, HOOK_TIMEOUT_MS.pre).catch(() => null);
    return { event: inputs.event, text: text ?? "" };
  }
}
