// CR-114 · hub-agent-handoff · bàn giao bằng tham chiếu trong vòng Orchestrator (thuần + một cổng ghi tiêm vào).
// - Kết quả agent ≥ 300 token ⇒ lưu artifact; `<steps>` giữ nguyên văn bước MỚI NHẤT (Orchestrator không có MCP, cần nó để
//   quyết/trả lời), các bước cũ còn trích đoạn + `art:…`.
// - Delegate sau đó nhận phong bì `{g,in,c,o,b}`: kết quả bước trước là `ref` nếu agent đọc được MCP (`canFetch`), không thì
//   nguyên văn (không mất dữ kiện).
// - Lịch sử > N lượt ⇒ tóm tắt + khoá artifact giữ nguyên văn lượt cũ, N lượt cuối giữ nguyên.
import type { AgentResult, HistoryItem } from "@ai/contracts/hub";
import {
  type ArtifactRef,
  type HandoffInput,
  inputOf,
  renderEnvelope,
  shouldInline,
} from "../artifacts/artifact.rules";
import {
  compactHistory,
  KEEP_LAST_TURNS,
  olderBody,
  splitHistory,
} from "../artifacts/history.rules";
import type { AgentConfig } from "../config/config.rules";
import type { StepNote } from "./orchestrator.prompt";
import { canPassThrough } from "./orchestrator.rules";

export type LoopHandoff = {
  put(body: string, meta: { summary?: string }): Promise<ArtifactRef>;
  /** Job của agent có MCP `/mcp` (đọc được `artifact.get`). */
  canFetch(agent: AgentConfig): boolean;
  keepTurns?: number;
};

/** Một kết quả bước đã có (theo thứ tự). `ref` null = nhỏ, giữ nguyên văn. */
export type StepOutput = { agent: string; text: string; ref: ArtifactRef | null };

/** Trích đoạn bước cũ trong `<steps>`. */
export const STEP_EXCERPT_CHARS = 400;

/** Kết quả sẽ vào `<steps>` (không pass-through, không hỏi lại) ⇒ đáng lưu artifact. */
export const willNote = (
  s: { delegates: number; hadPartial: boolean },
  r: AgentResult,
): r is Exclude<AgentResult, { status: "need_input" }> =>
  r.status === "partial" || (r.status === "done" && !canPassThrough(s, r));

/** Lưu kết quả bước khi đáng (≥ ngưỡng inline); lỗi kho ⇒ null (giữ nguyên văn, không làm hỏng run). */
export async function storeOutput(h: LoopHandoff, text: string): Promise<ArtifactRef | null> {
  if (shouldInline(text)) return null;
  try {
    return await h.put(text, {});
  } catch {
    return null;
  }
}

const excerpt = (text: string, ref: ArtifactRef): string => {
  const pts = [...text];
  const head =
    pts.length <= STEP_EXCERPT_CHARS ? text : `${pts.slice(0, STEP_EXCERPT_CHARS).join("")}…`;
  return `${head} [full: ${ref.short}, ${ref.tokens} tok]`;
};

/** `<steps>`: mọi bước trừ bước cuối có ref ⇒ trích đoạn + khoá. `refs[i]` ứng với `notes[i]`. */
export function stepsView(
  notes: readonly StepNote[],
  refs: readonly (ArtifactRef | null)[],
): StepNote[] {
  const last = notes.length - 1;
  return notes.map((n, i) => {
    const ref = refs[i];
    if (i === last || !ref || n.status === "skipped") return n;
    return { ...n, text: excerpt(n.text, ref) };
  });
}

/** Prompt của delegate: không có bước trước ⇒ `task` nguyên như cũ; có ⇒ phong bì với `in`. */
export function delegatePrompt(
  task: string,
  prior: readonly StepOutput[],
  o: { canFetch: boolean; budget?: number },
): string {
  if (prior.length === 0) return task;
  const inputs: HandoffInput[] = prior.map((p) =>
    o.canFetch ? inputOf(p.text, p.ref) : { text: p.text },
  );
  return renderEnvelope({
    g: task,
    in: inputs,
    o: "answer",
    ...(o.budget && o.budget > 0 ? { b: o.budget } : {}),
  });
}

/** `prompt` của job delegate: không `handoff` ⇒ `task` nguyên văn (như cũ). */
export const delegateTask = (
  h: LoopHandoff | undefined,
  d: { agent: AgentConfig; task: string },
  prior: readonly StepOutput[],
  budget: number,
): string =>
  h ? delegatePrompt(d.task, prior, { canFetch: h.canFetch(d.agent), budget }) : d.task;

/** Lịch sử đã nén cho cả run (một lần ghi artifact cho các lượt cũ). */
export async function compactRunHistory(
  h: LoopHandoff,
  history: readonly HistoryItem[],
): Promise<HistoryItem[]> {
  const keep = h.keepTurns ?? KEEP_LAST_TURNS;
  const { older } = splitHistory(history, keep);
  if (older.length === 0) return [...history];
  let ref: string | null = null;
  try {
    ref = (await h.put(olderBody(older), { summary: `${older.length} earlier turns` })).short;
  } catch {
    ref = null;
  }
  return compactHistory(history, { keep, ref });
}
