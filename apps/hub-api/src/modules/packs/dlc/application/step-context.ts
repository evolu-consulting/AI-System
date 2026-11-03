// dlc-engine · ngữ cảnh chung của một lần chạy bước DLC (tool `dlc-step` trong stage engine): lượt (`dlc.flows`), tham số hằng
// của bước, góp ý khi người duyệt trả bước về, và tiện ích ghi trạng thái / gọi agent. Lớp 2.
import { PackToolBusinessError } from "../../kit/domain/pack-tool-error";
import type { DlcAction, DlcMode } from "../domain/dlc-flow.rules";
import type {
  AgentCallOutcome,
  AgentHubBridge,
  DlcFlow,
  DlcOwnRepos,
  DlcState,
  DlcWho,
  WorkspacePort,
} from "./ports";

export type DlcSystemUow = {
  system<T>(tenantId: string, fn: (r: DlcOwnRepos) => Promise<T>): Promise<T>;
};
export type StepDeps = { uow: DlcSystemUow; ws: WorkspacePort; hub: AgentHubBridge };

export type StepArgs = {
  action: DlcAction;
  mode: DlcMode;
  step: string;
  agent: string;
  instruction: string;
  rounds: number;
};
/** Kết quả bước = `output.fields` của stage (bảng "Kết quả"). */
export type StepOut = { status: string; summary: string; project: string };

export type StepCtx = {
  d: StepDeps;
  tenantId: string;
  flow: DlcFlow;
  a: StepArgs;
  feedback: string | null;
  signal: AbortSignal | undefined;
};

export const fail = (msg: string): never => {
  throw new PackToolBusinessError(`dlc: ${msg}`);
};

/** Người bắt đầu + hội thoại của lượt (agent chạy ở đó, hỏi người ở đó); lượt không gắn hội thoại ⇒ lỗi bước. */
export function whoOf(c: StepCtx): DlcWho {
  const conv = c.flow.conversationId;
  if (!conv)
    fail("lượt không gắn hội thoại Chat — mở lượt từ Chat (dlc-agent) để agent hỏi được người");
  return { tenantId: c.tenantId, userId: c.flow.startedBy, conversationId: conv as string };
}

/** Gộp trạng thái mới vào lượt (cả bản nhớ của `c.flow` cho bước con dùng tiếp). */
export async function save(c: StepCtx, patch: DlcState): Promise<void> {
  await c.d.uow.system(c.tenantId, (r) => r.flows.patch(c.flow.id, patch));
  c.flow = { ...c.flow, state: { ...c.flow.state, ...patch } };
}

/** Ghi kết quả của bước (đưa lại cho agent khi bị trả về). */
export const withResult = (c: StepCtx, text: string): DlcState => ({
  results: { ...(c.flow.state.results ?? {}), [c.a.step]: text.slice(0, 40_000) },
});

/** Gọi agent trong hội thoại của lượt; không xong ⇒ lỗi bước (engine mở quyết định cho người). */
export async function callAgent(
  c: StepCtx,
  agentKey: string,
  prompt: string,
): Promise<AgentCallOutcome> {
  const port = c.d.hub.port;
  if (!port) return fail("Agent Hub chưa nối");
  if (!agentKey) return fail(`bước ${c.a.step} chưa chọn agent`);
  const out = await port.call(whoOf(c), agentKey, prompt, c.signal);
  if (out.status !== "done")
    fail(`agent ${agentKey} không xong (${out.status}${out.error ? `: ${out.error}` : ""})`);
  return out;
}

/** Văn bản kết quả + quyết định với người trong lúc làm (đưa cho bước sau). */
export function withDialog(out: AgentCallOutcome, max: number): string {
  const dialog = out.dialog
    .map((x) => `- Q: ${x.question.slice(0, 500)}\n  A: ${x.answer.slice(0, 500)}`)
    .join("\n");
  const text = out.text.length > max ? `${out.text.slice(0, max)}\n...(truncated)` : out.text;
  return dialog ? `${text}\n\n### Decisions with the person\n${dialog}` : text;
}

export const need = <T>(v: T | undefined | null, what: string): T =>
  v === undefined || v === null || v === "" ? fail(`thiếu ${what} — bước trước chưa chạy`) : v;

export const out = (c: StepCtx, status: string, summary: string): StepOut => ({
  status,
  summary: summary.replace(/\s+/g, " ").trim().slice(0, 1000),
  project: c.flow.project,
});
