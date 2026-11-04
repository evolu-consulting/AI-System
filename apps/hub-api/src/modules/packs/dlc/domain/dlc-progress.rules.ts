// dlc-progress · tiến độ một lượt DLC cho thẻ trên khung nhập Chat: bước quy trình đang ở đâu, việc nào của queue đang làm,
// agent nào đang chạy (+ thread của nó). Luật thuần: nhận dòng thời gian bước (engine), queue của lượt (workspace) và run agent
// mới nhất trong hội thoại; không gọi I/O.
import type { PackStepsView } from "../../kit/application/pack-runs.ports";
import type { QueueItem } from "./dlc-prompts.rules";

export type DlcAgentRun = {
  agent: string;
  flow_id: string;
  status: string;
  started_at: string;
};

export type DlcProgress = {
  status: string;
  /** Bước quy trình đang mở (chạy / chờ duyệt / dừng); vắng khi run đã kết thúc. */
  step: { idx: number; total: number; name: string; status: string } | null;
  tasks: { id: string; title: string; domain: string; status: string; attempts: number }[];
  done: number;
  /** Việc queue đang làm (`in_progress`), không có ⇒ null. */
  current: { id: string; title: string } | null;
  /** Run agent DLC mới nhất của hội thoại (bấm để mở thread). */
  agent: DlcAgentRun | null;
  /** URL app vừa deploy thành công của lượt (bước deploy) ⇒ thẻ chat cho người dùng mở app; chưa deploy ⇒ null. */
  app_url: string | null;
};

const ACTIVE_STEP = new Set(["running", "open", "failed"]);
const DONE_TASK = new Set(["ready_to_deploy", "deployed"]);

/** Việc của lượt: id có tiền tố mã lượt (`<tag>-tN`); không có mã ⇒ không lọc được ⇒ rỗng. */
export function tasksOfRun(queue: readonly QueueItem[], tag: string | undefined): QueueItem[] {
  if (!tag) return [];
  return queue.filter((q) => q.id.startsWith(`${tag}-`));
}

export function dlcProgress(
  v: PackStepsView,
  queue: readonly QueueItem[],
  agent: DlcAgentRun | null,
  deploy?: { ok: boolean; url: string | null } | null,
): DlcProgress {
  const open = v.steps.find((s) => ACTIVE_STEP.has(s.status));
  const tasks = queue.map((q) => ({
    id: q.id,
    title: q.title ?? q.id,
    domain: q.domain ?? "",
    status: q.status ?? "queued",
    attempts: Number(q.attempts ?? 0),
  }));
  const cur = tasks.find((t) => t.status === "in_progress");
  return {
    status: v.status,
    step: open
      ? { idx: open.idx, total: v.steps.length, name: open.name, status: open.status }
      : null,
    tasks,
    done: tasks.filter((t) => DONE_TASK.has(t.status)).length,
    current: cur ? { id: cur.id, title: cur.title } : null,
    agent,
    app_url: deploy?.ok && deploy.url ? deploy.url : null,
  };
}
