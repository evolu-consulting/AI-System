// CR-116 B3 · Luật 4c · người nhận `process.updated` của LÔ (vòng hẹn giờ `systemEach`): thay vì gọi definer
// `hub.process_run_recipients` mỗi hẹn (100 câu/lô), hàng chỉ ghi chỗ chờ (mảng sự kiện rỗng đã đặt sẵn đúng vị trí trong
// outbox ⇒ thứ tự sự kiện giữ nguyên), cuối tx lô (TRƯỚC COMMIT, cùng tx scope system) gom MỘT câu `runRecipientsMany`
// rồi điền vào. Người nhận = trạng thái cuối tx lô (cũng là trạng thái được COMMIT và phát).
import type { Tx } from "@ai/db";
import type { UserEvent } from "../../../lib/user-stream";
import { runRecipientsMany } from "./core.repo";
import { processUpdated } from "./events";

type UpdatedRun = Parameters<typeof processUpdated>[1];
export type PendingUpdated = {
  runId: string;
  tenantId: string;
  run: UpdatedRun;
  into: UserEvent[];
};
export type RecipientsDefer = { add(p: PendingUpdated): void; readonly pending: PendingUpdated[] };

export function recipientsDefer(): RecipientsDefer {
  const pending: PendingUpdated[] = [];
  return { pending, add: (p) => void pending.push(p) };
}

/** MỘT câu cho cả lô (0 câu khi lô rỗng): điền sự kiện vào từng chỗ chờ. */
export async function resolveDeferred(tx: Tx, pending: readonly PendingUpdated[]): Promise<void> {
  if (pending.length === 0) return;
  const keys = new Map(pending.map((p) => [`${p.runId}:${p.tenantId}`, p] as const));
  const recips = await runRecipientsMany(
    tx,
    [...keys.values()].map((p) => ({ runId: p.runId, tenantId: p.tenantId })),
  );
  for (const p of pending) p.into.push(...processUpdated(recips.get(p.runId) ?? [], p.run));
}
