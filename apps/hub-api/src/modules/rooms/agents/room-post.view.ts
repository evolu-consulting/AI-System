// HUB-FR-101 · HUB-FR-95 · X2b tin agent theo người xem (plan D3, §7; R10, R12). Thuần: dùng chung cho timeline
// (`messages.repo`) và `room.message` của `RoomRunPoster`. Bản riêng (`content`/`ask` side_effect) chỉ cho người gọi.
import { type Ask, CHAT_CONTENT_MAX, type RoomAgentRef } from "@ai/contracts/chat";
import type { AgentPartRow, RoomMessageRow } from "../rooms.map";
import { askForViewer } from "./room-agent.rules";

export type WaitKind = "need_input" | "side_effect";

/** Dữ liệu tin agent: cột `room_messages` (công khai) + bản riêng (`hub.messages` của run, chỉ có khi người xem là người gọi). */
export type AgentData = {
  runId: string;
  triggerMessageId: string;
  runStatus: AgentPartRow["runStatus"];
  waitKind: WaitKind | null;
  ask: Ask | null;
  stepCount: number | null;
  runMs: number | null;
  agent: RoomAgentRef | null;
  caller: { id: string; displayName: string | null; username: string | null };
  content: string;
  privateContent: string | null;
  privateAsk: Ask | null;
};

/** Tên hiển thị của agent gửi tin (Orchestrator khi không có agent). */
export const agentDisplayName = (a: RoomAgentRef | null): string => a?.name.vi ?? "Orchestrator";

/** D3 · `side_effect`: người gọi nhận nội dung + câu hỏi riêng; người khác bản công khai (câu chung, `ask` chỉ `kind`). */
export function agentViewFor(
  d: AgentData,
  viewerId: string,
): { content: string; agent: AgentPartRow } {
  const isCaller = viewerId === d.caller.id;
  const priv = isCaller && d.waitKind === "side_effect" ? d.privateContent : null;
  const ask = askForViewer({
    waitKind: d.waitKind,
    ask: d.ask,
    privateAsk: d.privateAsk,
    isCaller,
  });
  const steps =
    d.stepCount !== null && d.runMs !== null ? { count: d.stepCount, ms: d.runMs } : undefined;
  return {
    content: priv ? priv.slice(0, CHAT_CONTENT_MAX) : d.content,
    agent: {
      runId: d.runId,
      triggerMessageId: d.triggerMessageId,
      runStatus: d.runStatus,
      ref: d.agent,
      caller: d.caller,
      ...(ask && { ask }),
      ...(steps && { steps }),
    },
  };
}

/** Áp bản theo người xem lên hàng tin agent (giữ nguyên tin người). */
export function rowFor(row: RoomMessageRow, d: AgentData | null, viewerId: string): RoomMessageRow {
  if (!d) return row;
  const v = agentViewFor(d, viewerId);
  const sender = { ...row.sender, displayName: agentDisplayName(d.agent) };
  return { ...row, sender, content: v.content, agent: v.agent };
}
