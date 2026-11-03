// CR-114 · hub-agent-handoff · bàn giao bằng tham chiếu trong vòng Orchestrator (thuần + một cổng ghi tiêm vào).
// fix114: người đọc KHÔNG có MCP artifact (Orchestrator, dify, direct-SDK, job noTools, job đã đủ MCP_TOOLS_MAX) thấy y như
// khi tắt cờ: `<steps>` và lịch sử nguyên văn, `prompt` = task. Bản tham chiếu đi kèm job ở `byRef`; chỉ runner job — nơi
// cấp tool — chọn nó khi job THỰC SỰ nhận `artifact-get` (`artifactToolsGranted`), nên không ai nhận `ref` mà không đọc được.
// - Kết quả agent ≥ 300 token ⇒ lưu artifact; bản tham chiếu mang phong bì `{g,in,o,b}` (`in` = ref + tóm tắt).
// - Lịch sử > N lượt ⇒ bản tham chiếu mang tóm tắt + khoá artifact giữ nguyên văn lượt cũ, N lượt cuối nguyên văn.
import type { AgentResult, HistoryItem } from "@ai/contracts/hub";
import {
  type ArtifactRef,
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
import { canPassThrough } from "./orchestrator.rules";

export type LoopHandoff = {
  put(body: string, meta: { summary?: string }): Promise<ArtifactRef>;
  keepTurns?: number;
};

/** Bản tham chiếu của một job delegate (runner job chỉ dùng khi đã cấp `artifact-get`). */
export type ByRef = { prompt: string; history: readonly HistoryItem[] };

/** Một kết quả bước đã có (theo thứ tự). `ref` null = nhỏ, giữ nguyên văn. */
export type StepOutput = { agent: string; text: string; ref: ArtifactRef | null };

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

/** Prompt tham chiếu: không có bước trước ⇒ `task` nguyên; có ⇒ phong bì, kết quả lớn thành `ref`. */
export function delegatePrompt(
  task: string,
  prior: readonly StepOutput[],
  budget?: number,
): string {
  if (prior.length === 0) return task;
  return renderEnvelope({
    g: task,
    in: prior.map((p) => inputOf(p.text, p.ref)),
    o: "answer",
    ...(budget && budget > 0 ? { b: budget } : {}),
  });
}

/** Lịch sử đã nén cho bản tham chiếu (một lần ghi artifact cho các lượt cũ); ngắn / lỗi kho ⇒ null (dùng nguyên văn). */
export async function compactRunHistory(
  h: LoopHandoff,
  history: readonly HistoryItem[],
): Promise<HistoryItem[] | null> {
  const keep = h.keepTurns ?? KEEP_LAST_TURNS;
  const { older } = splitHistory(history, keep);
  if (older.length === 0) return null;
  try {
    const ref = (await h.put(olderBody(older), { summary: `${older.length} earlier turns` })).short;
    return compactHistory(history, { keep, ref });
  } catch {
    return null;
  }
}

/** `byRef` của delegate cho vòng lặp: lịch sử nén ghi artifact một lần mỗi run (`st.compacted`, lười, chỉ khi có delegate). */
export async function byRefJob(
  h: LoopHandoff,
  st: { outputs: readonly StepOutput[]; compacted?: Promise<HistoryItem[] | null> },
  history: readonly HistoryItem[],
  task: string,
  budget: number,
): Promise<{ byRef?: ByRef }> {
  st.compacted ??= compactRunHistory(h, history);
  const b = byRefOf(task, st.outputs, history, await st.compacted, budget);
  return b ? { byRef: b } : {};
}

/** `byRef` của job delegate; không có gì để rút gọn (không bước trước, lịch sử ngắn) ⇒ undefined (job như cũ). */
export function byRefOf(
  task: string,
  prior: readonly StepOutput[],
  history: readonly HistoryItem[],
  compacted: readonly HistoryItem[] | null,
  budget: number,
): ByRef | undefined {
  if (prior.every((p) => !p.ref) && !compacted) return undefined;
  return { prompt: delegatePrompt(task, prior, budget), history: compacted ?? history };
}
