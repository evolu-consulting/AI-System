// HUB-FR-42 · HUB-FR-45 · E13/E14/E15 · dựng `Run` + sự kiện kết thúc từ DB / `sse:<id>` (tách khỏi `runs.service.ts`).
import type { Run, RunError } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import type { Redis } from "../../lib/redis";
import * as repo from "./runs.repo";
import { isTerminalEvent, lastSseEntry, type SseEventBody } from "./sse/sse-writer";

/** Sự kiện kết thúc dựng từ cột `runs` + tin assistant (không gọi lại `runErrorText`, plan-errors §Ghi). */
export async function terminalFromDb(
  tx: Tx,
  o: repo.Owner,
  r: repo.RunRecord,
): Promise<SseEventBody> {
  const base = { run_id: r.id, message_id: r.answerMessageId };
  if (r.status !== "finished") {
    return { event: "run.failed", data: { ...base, ...toRunError(r) } };
  }
  const content = (await repo.messageContent(tx, o, r.answerMessageId)) ?? "";
  const ms = Math.max(0, (r.finishedAt?.getTime() ?? 0) - r.startedAt.getTime());
  return { event: "run.finished", data: { ...base, content, ms } };
}

/** `Run` (contract chat) từ dòng `runs`; `lastEventId` do người gọi chọn (E14 · E15). */
export function toRun(r: repo.RunRecord, lastEventId: number): Run {
  return {
    id: r.id,
    conversation_id: r.conversationId,
    flow_id: r.flowId,
    status: r.status,
    started_at: r.startedAt.toISOString(),
    finished_at: r.finishedAt?.toISOString() ?? null,
    last_event_id: lastEventId,
    error: toRunError(r),
  };
}

function toRunError(r: repo.RunRecord): RunError | null {
  if (!r.errorCode) return null;
  return {
    code: r.errorCode as RunError["code"],
    message: r.errorMessage ?? r.errorCode,
    hint: r.errorHint ?? "",
  };
}

/** E14/E15 · run xong → `runs.last_seq`; đang chạy → id cuối `sse:<id>`. */
export async function lastEventIdOf(redis: Redis, r: repo.RunRecord): Promise<number> {
  return r.status === "running" ? (await lastSseEntry(redis, r.id)).seq : r.lastSeq;
}

/** Id sự kiện kết thúc đang ở cuối `sse:<id>` (null khi chưa có). */
export async function terminalSeqOf(redis: Redis, runId: string): Promise<number | null> {
  const last = await lastSseEntry(redis, runId);
  return last.event && isTerminalEvent(last.event) ? last.seq : null;
}
