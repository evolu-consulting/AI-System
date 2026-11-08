// CR-125 · purchase-flow G3 · «A + B cùng duyệt» — phần MỞ thẻ: bước Duyệt có `after.parallel` ⇒ một thẻ duyệt cho TỪNG nhóm cùng
// lúc (nhắc / chuyển cấp chép từ snapshot cho từng thẻ ⇒ áp riêng mỗi nhóm). Tách khỏi `parallel-approve.ts` (phần quyết) để
// `team-runner` / `gates.effects` import không tạo vòng. Chạy trong tx đã khoá run.
import type { ParallelRule } from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import type { UserEvent } from "../../../lib/user-stream";
import * as core from "../core/core.repo";
import type { ProcessDeps } from "../core/ports";

export type ParallelSnap = {
  executor?: { kind?: string };
  after?: {
    kind?: string;
    parallel?: { groups?: { group_id?: string | null }[]; rule?: ParallelRule };
  };
};

/** Id nhóm của bước cùng duyệt (đã gắn id lúc mở lượt); không phải bước Duyệt cùng duyệt ⇒ null. */
export function parallelGroupIds(def: unknown): string[] | null {
  const s = def as ParallelSnap | undefined;
  const p = s?.after?.kind === "review" ? s.after.parallel : undefined;
  if (s?.executor?.kind !== "approve" || !p?.groups || p.groups.length < 2) return null;
  return p.groups.map((x) => x.group_id ?? null).filter((x): x is string => typeof x === "string");
}

type Opener = Pick<ProcessDeps, "now" | "notifier">;
type OpenP = {
  tenantId: string;
  runId: string;
  stageRunId: string;
  outputId: string | null;
  groupIds: string[];
};
/** Mở thẻ duyệt cho TỪNG nhóm (≤ 5). Trả thẻ đầu (tin thread `review_task_id`) + sự kiện mở thẻ. */
export async function openParallel(
  d: Opener,
  tx: Tx,
  p: OpenP,
): Promise<{ taskId: string; events: UserEvent[] }> {
  const remindAt = new Date(d.now().getTime() + 86_400_000);
  const { groupIds, ...base } = p;
  const ids: string[] = [];
  for (const groupId of groupIds)
    ids.push(
      await core.insertTask(tx, { ...base, kind: "review", remindAt, userIds: [], groupId }),
    );
  const events = (await Promise.all(ids.map((id) => d.notifier.taskOpened(tx, id)))).flat();
  return { taskId: ids[0] ?? "", events };
}
