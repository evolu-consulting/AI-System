// HUB-FR-101 · HUB-BR-21 · HUB-BR-22 · X2b-R01–R03, R07, R08, R10–R13, R16, R17, R19, Q2 · luật thuần agent trong phòng
// (plan X2b §8, §6; D8, D12–D15). Không DB/IO. Test khoá: `tests/acceptance/X2b/rules/room-agent-rules.test.ts`.
import type { Ask, RoomAsk } from "@ai/contracts/chat";
import { HISTORY_CONTENT_MAX, type HistoryItem } from "@ai/contracts/hub";
import { type MentionRouted, routeMessage } from "../../mention/mention-parse.rules";

/** Tag dành riêng trong phòng (D8): Orchestrator đủ AU, hoặc thu hẹp theo các tag đi kèm. */
export const ORCHESTRATOR_TAG = "orchestrator";

export type RoomRoute =
  | { kind: "plain" }
  | { kind: "agents"; routed: MentionRouted }
  | { kind: "orchestrator"; content: string; onlyKeys?: ReadonlySet<string> }
  | { kind: "answer"; runId: string; content: string };

/**
 * R01–R03, D8, D13 · `answerRunId` ⇒ `answer` (không parse tag). Không `@` đầu tin / `@@` / `/…` ⇒ `plain` (Q10: lệnh
 * là chữ thường trong phòng). `@orchestrator` (+ tag khác ⇒ `onlyKeys`) ⇒ `orchestrator`; còn lại ⇒ `agents`.
 */
export function routeRoomMessage(content: string, opt: { answerRunId?: string }): RoomRoute {
  if (opt.answerRunId !== undefined) return { kind: "answer", runId: opt.answerRunId, content };
  const r = routeMessage(content);
  if (r.kind === "text" || r.kind === "command") return { kind: "plain" };
  if (r.kind === "mention_error" || !r.tags.includes(ORCHESTRATOR_TAG))
    return { kind: "agents", routed: r };
  const rest = r.tags.filter((t) => t !== ORCHESTRATOR_TAG);
  return rest.length > 0
    ? { kind: "orchestrator", content: r.content, onlyKeys: new Set(rest) }
    : { kind: "orchestrator", content: r.content };
}

/** R01, AC12 · chỉ tin người của thành viên hiện tại mới gọi agent (tin agent không bao giờ ⇒ chặn vòng lặp). */
export function canTriggerRun(m: { senderType: "user" | "agent"; activeMember: boolean }): boolean {
  return m.senderType === "user" && m.activeMember;
}

/** R11 (lần 2) · run không có / khác thread / không chờ ⇒ `not_found` (trước `not_caller`). */
export function answerAccess(p: {
  run: { inThread: boolean; waiting: boolean; callerId: string } | null;
  userId: string;
}): "ok" | "not_found" | "not_caller" {
  const r = p.run;
  if (!r?.inThread || !r.waiting) return "not_found";
  return r.callerId === p.userId ? "ok" : "not_caller";
}

/** D12 · tin mở thread / timeline = `main`; tin khác trong thread = `flow`; tin agent theo tin gọi nó. */
export function placementOf(m: {
  senderType: "user" | "agent";
  flowId: string | null;
  opensThread: boolean;
  triggerPlacement?: "main" | "flow";
}): "main" | "flow" {
  if (m.senderType === "agent") return m.triggerPlacement ?? "main";
  return m.flowId === null || m.opensThread ? "main" : "flow";
}

export type RoomCtxRow = {
  roomId: string;
  flowId: string | null;
  seq: number;
  senderType: "user" | "agent";
  senderName: string;
  content: string;
  placement: "main" | "flow";
};

/** §6 · ≤ 20 tin timeline, ≤ 50 tin thread. */
export const ROOM_CONTEXT_MAX = { main: 20, thread: 50 } as const;

const lastN = <T>(xs: readonly T[], n: number): T[] => (n > 0 ? xs.slice(-n) : []);
const bySeq = (a: RoomCtxRow, b: RoomCtxRow) => a.seq - b.seq;

function toItem(r: RoomCtxRow): HistoryItem {
  const content = r.senderType === "user" ? `${r.senderName}: ${r.content}` : r.content;
  return {
    role: r.senderType === "user" ? "user" : "assistant",
    content: content.slice(0, HISTORY_CONTENT_MAX),
  };
}

/** Mục liền nhau cùng role gộp bằng `\n` (luân phiên user/assistant). */
function mergeRoles(items: readonly HistoryItem[]): HistoryItem[] {
  const out: HistoryItem[] = [];
  for (const it of items) {
    const prev = out.at(-1);
    if (prev && prev.role === it.role)
      prev.content = `${prev.content}\n${it.content}`.slice(0, HISTORY_CONTENT_MAX);
    else out.push({ ...it });
  }
  return out;
}

/**
 * §6 · ngữ cảnh run phòng (cũ→mới): ≤ `max.main` tin `main` có `seq` < (tin gốc thread ?? tin gọi) + ≤ `max.thread` tin
 * thread có `seq` < tin gọi. Lớp 2 cách ly: bỏ mọi dòng lệch phòng / lệch thread / sai placement dù được truyền vào.
 */
export function roomContext(
  p: {
    roomId: string;
    triggerSeq: number;
    main: readonly RoomCtxRow[];
    thread?: { flowId: string; rootSeq: number; rows: readonly RoomCtxRow[] };
  },
  max: { main: number; thread: number } = ROOM_CONTEXT_MAX,
): HistoryItem[] {
  const t = p.thread;
  const mainBefore = t ? Math.min(t.rootSeq, p.triggerSeq) : p.triggerSeq;
  const main = p.main
    .filter((r) => r.roomId === p.roomId && r.placement === "main" && r.seq < mainBefore)
    .sort(bySeq);
  const thread = t
    ? t.rows
        .filter((r) => r.roomId === p.roomId && r.flowId === t.flowId && r.seq < p.triggerSeq)
        .sort(bySeq)
    : [];
  const rows = [...lastN(main, max.main), ...lastN(thread, max.thread)];
  return mergeRoles(rows.map(toItem));
}

export type AgentOutcome = {
  status: "finished" | "failed" | "cancelled";
  content: string;
  ask: Ask | null;
  pendingConfirm: boolean;
  locale: "vi" | "en";
};

const GENERIC = {
  side_effect: {
    vi: "Agent cần người gọi xác nhận một thao tác.",
    en: "The agent needs the caller to confirm an action.",
  },
  failed: {
    vi: "Agent không hoàn thành được yêu cầu.",
    en: "The agent could not complete the request.",
  },
  cancelled: { vi: "Đã huỷ.", en: "Cancelled." },
} as const;

/** R10/R12/R16 · bản công khai của tin agent: `side_effect` ⇒ câu chung + `ask` null; lỗi/huỷ ⇒ câu chung. */
export function agentMessageView(o: AgentOutcome): {
  content: string;
  runStatus: AgentOutcome["status"];
  waitKind: "need_input" | "side_effect" | null;
  ask: Ask | null;
} {
  if (o.status !== "finished")
    return { content: GENERIC[o.status][o.locale], runStatus: o.status, waitKind: null, ask: null };
  if (o.pendingConfirm)
    return {
      content: GENERIC.side_effect[o.locale],
      runStatus: "finished",
      waitKind: "side_effect",
      ask: null,
    };
  if (o.ask)
    return { content: o.content, runStatus: "finished", waitKind: "need_input", ask: o.ask };
  return { content: o.content, runStatus: "finished", waitKind: null, ask: null };
}

/** R12 · `side_effect`: chỉ người gọi thấy câu hỏi/lựa chọn riêng; `need_input`: mọi người thấy câu hỏi công khai. */
export function askForViewer(m: {
  waitKind: string | null;
  ask: Ask | null;
  privateAsk: Ask | null;
  isCaller: boolean;
}): RoomAsk | undefined {
  if (m.waitKind === "side_effect")
    return m.isCaller && m.privateAsk
      ? { kind: "side_effect", ...m.privateAsk }
      : { kind: "side_effect" };
  if (m.waitKind === "need_input")
    return m.ask ? { kind: "need_input", ...m.ask } : { kind: "need_input" };
  return undefined;
}

/** D14 · mốc đọc người gọi lên `seq` chỉ khi đang = `seq − 1` (đã đọc hết). */
export function callerReadAfterPost(lastReadSeq: number, seq: number): number | null {
  return lastReadSeq === seq - 1 ? seq : null;
}

/** R17 · đăng tin agent chỉ khi run đã dừng, chưa đăng, phòng còn, người gọi còn là thành viên. */
export function shouldPost(p: {
  running: boolean;
  posted: boolean;
  roomDeleted: boolean;
  callerActive: boolean;
}): boolean {
  return !p.running && !p.posted && !p.roomDeleted && p.callerActive;
}

/** D15 [Q2] · agent đang chờ xác nhận còn trong AU (ảnh hiện hành) của người xác nhận. */
export function confirmStillAllowed(agentId: string, au: ReadonlySet<string>): boolean {
  return au.has(agentId);
}
