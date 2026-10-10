// CR-056 · P-a plan-frontend-thread §2: `useThreadRun(runId, taskId?)` = view của run + `taskSlot` cho một tin trong thread.
import { type TaskSlot, taskSlot } from "../lib/thread-task";
import { useProcessRun } from "./use-process-run";

export function useThreadRun(runId: string | undefined, taskId?: string | null, enabled = true) {
  const q = useProcessRun(runId, enabled);
  const slot: TaskSlot = taskId ? taskSlot(q.data, taskId) : { state: "none" };
  return { ...q, view: q.data, slot };
}
