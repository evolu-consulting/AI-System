// CR-054 · tiền tố agent của một bước: "Orchestrator · Haiku" (alias model viết hoa chữ đầu; id ghim giữ nguyên).
import type { StepAgent } from "@ai/contracts/chat";

/** Alias "luôn bản mới nhất" của Claude CLI; `default` = theo cài đặt máy Runtime → không hiện. */
const ALIASES: ReadonlySet<string> = new Set(["opus", "sonnet", "haiku"]);

/** `haiku` → "Haiku"; `default`/null → null; id cụ thể (`claude-sonnet-4-5`) giữ nguyên. */
export function modelLabel(model: string | null | undefined): string | null {
  const m = model?.trim() ?? "";
  if (m === "" || m === "default") return null;
  return ALIASES.has(m) ? m.charAt(0).toUpperCase() + m.slice(1) : m;
}

/** "Orchestrator · Haiku" | "Invoices" | null (bước không gắn agent). */
export function stepAgentPrefix(
  agent: Pick<StepAgent, "name" | "model"> | undefined,
): string | null {
  if (!agent) return null;
  const model = modelLabel(agent.model);
  return model ? `${agent.name} · ${model}` : agent.name;
}
