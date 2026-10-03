// UC-02, UC-08 · ghép `RunDriver` với I/O thật: API E12–E15, `readEvents`, rAF, QueryClient; đăng xuất → bỏ mọi run.
import { queryClient } from "~/app/query-client";
import { session } from "~/lib/auth/session";
import { readEvents } from "~/lib/sse";
import { cancelRun, getRun, openEvents, sendMessage } from "./api";
import type { RunState } from "./lib/reducer";
import { RunDriver } from "./run-driver";
import { runStore } from "./run-store";

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

function requestFrame(cb: () => void): void {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => cb());
  else setTimeout(cb, 16);
}

/** Query bị ảnh hưởng khi run kết thúc (plan-frontend §3: danh sách, flow, tin của flow). */
function refreshQueries(run: RunState): Promise<unknown> {
  const jobs: Promise<unknown>[] = [
    queryClient.invalidateQueries({ queryKey: ["conversations"] }),
    queryClient.invalidateQueries({ queryKey: ["conv", run.convId] }),
  ];
  if (run.flowId) jobs.push(queryClient.invalidateQueries({ queryKey: ["flow", run.flowId] }));
  return Promise.allSettled(jobs);
}

let seq = 0;

export const runDriver = new RunDriver(runStore, {
  sendMessage,
  openEvents,
  cancelRun,
  getRun,
  readEvents,
  sleep,
  requestFrame,
  // Run đã kết thúc vẫn ở store tới khi view thấy `answerId` trong query rồi gọi `runDriver.drop` (tránh nháy);
  // rời hội thoại trước đó → `runStore` tự bỏ run đã kết thúc cũ nhất vượt `MAX_SETTLED_RUNS`.
  onSettled: (run) => void refreshQueries(run),
  onExpired: (run) => {
    void refreshQueries(run).then(() => runStore.remove(run.key));
  },
  newKey: () => `run-${Date.now().toString(36)}-${(seq++).toString(36)}`,
});

session.on("cleared", () => runDriver.dropAll());
session.on("expired", () => runDriver.dropAll());
