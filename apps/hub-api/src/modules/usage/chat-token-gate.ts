// TD #252 · cửa trần token tenant cho lượt chat qua gói Claude (worker `claude_agent_sdk`): usage chat ghi `subscription` và
// tính vào trần tenant/ngày, nhưng trước đây lượt chat KHÔNG bị chặn khi tenant đã vượt trần. Cửa này GIỮ CHỖ nguyên tử
// (`hub.ai_reserve_tokens`) TRƯỚC khi đẩy job — cùng cơ chế với `ai-client` — và trả chỗ khi lượt xong (usage thật đã/ sắp
// được ghi và gắn tenant bởi `chatUsageSink`). Trần null ⇒ không giới hạn. Lỗi DB ⇒ ném (đóng, như ai-client `unavailable`).
import type { RunEvent } from "@ai/contracts/hub";
import { estimateInputTokens, type UsageStore, utcDayStart } from "../../lib/ai-client/ai-client";
import type { Logger } from "../../lib/logger";
import { syntheticFailed } from "../runner/runner.rules";

/** Phần output tối đa giữ chỗ cho một lượt chat (đủ rộng; còn ít hơn `MIN_OUTPUT_TOKENS` ⇒ chặn). */
export const CHAT_HOLD_MAX_OUTPUT = 32_000;
export const CHAT_HOLD_MIN_OUTPUT = 1_024;
/** Hạn chỗ giữ cộng thêm sau hạn run (tiến trình chết giữa chừng ⇒ tự hết). */
const HOLD_SLACK_S = 600;

export type ChatGateTask = {
  run: { tenantId: string };
  agent: { timeoutS: number };
  prompt: string;
  systemPrompt?: string;
  history: readonly { content: string }[];
};
/** `null` ⇒ vượt trần (không đẩy job). `holdId` null ⇒ không giới hạn / không cần trả. */
export type ChatHold = { holdId: string | null; tenantId: string };
export type ChatTokenGate = {
  reserve(task: ChatGateTask): Promise<ChatHold | null>;
  release(hold: ChatHold): Promise<void>;
};

export function chatTokenGate(d: {
  usage: Pick<UsageStore, "reserve" | "release" | "tokensSince">;
  /** Trần tenant/ngày; null ⇒ không giới hạn. */
  cap: () => number | null;
  now?: () => Date;
}): ChatTokenGate {
  const now = d.now ?? (() => new Date());
  return {
    async reserve(t) {
      const cap = d.cap();
      if (cap === null) return { holdId: null, tenantId: t.run.tenantId };
      const since = utcDayStart(now());
      const tenantId = t.run.tenantId;
      if (!d.usage.reserve)
        return (await d.usage.tokensSince(tenantId, since)) < cap
          ? { holdId: null, tenantId }
          : null;
      const hold = await d.usage.reserve({
        tenantId,
        since,
        cap,
        inputTokens: estimateInputTokens({
          system: t.systemPrompt ?? "",
          prompt: [t.prompt, ...t.history.map((h) => h.content)].join("\n"),
        }),
        maxOutput: CHAT_HOLD_MAX_OUTPUT,
        minOutput: CHAT_HOLD_MIN_OUTPUT,
        ttlS: Math.max(1, Math.ceil(t.agent.timeoutS)) + HOLD_SLACK_S,
      });
      return hold ? { holdId: hold.holdId, tenantId } : null;
    },
    async release(h) {
      if (h.holdId && d.usage.release) await d.usage.release(h.holdId, h.tenantId);
    },
  };
}

/** Bọc một lượt chạy job: vượt trần ⇒ MỘT `job.failed` ALL_PROVIDERS_EXHAUSTED/quota (không dựng payload, không INSERT job);
 *  còn trần ⇒ chạy `inner` rồi trả chỗ giữ (kể cả khi `inner` ném/bị huỷ). `gate` vắng ⇒ chạy thẳng. */
export async function* gatedRun(
  gate: ChatTokenGate | undefined,
  task: ChatGateTask & { run: { id: string } },
  log: Pick<Logger, "warn">,
  inner: () => AsyncGenerator<RunEvent>,
): AsyncGenerator<RunEvent> {
  const hold = gate ? await gate.reserve(task) : undefined;
  if (hold === null) {
    log.warn("chat-token-cap-exceeded", { run_id: task.run.id });
    const f = { code: "ALL_PROVIDERS_EXHAUSTED", reason: "quota" } as const;
    yield syntheticFailed(crypto.randomUUID(), {
      ...f,
      message: "tenant daily token cap exceeded",
    });
    return;
  }
  try {
    yield* inner();
  } finally {
    if (gate && hold)
      await gate
        .release(hold)
        .catch(() => log.warn("chat-token-release-failed", { run_id: task.run.id }));
  }
}
