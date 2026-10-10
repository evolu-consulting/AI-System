// HUB-FR-104…117 · D15 · mount module quy trình khi cờ `HUB_PROCESS_ENGINE=on` (plan §8 hàng 0b, plan-contract §7.1):
// route mọi PF (file của từng PF, mount sẵn ⇒ PF không sửa file này), ThreadPoster + vòng nền, seam N3. Cờ tắt ⇒ `app.ts`
// không gọi ⇒ mọi route quy trình 404, `!` là chữ thường.
import { PROCESS_RUNS_PER_TENANT } from "@ai/contracts/chat";
import type { Env, Hono } from "hono";
import type { RoomProcessSender } from "../rooms/messages/messages.service";
import { asksRoutes } from "./asks/asks.routes";
import { type Clock, clockOf } from "./core/clock";
import type { ProcessHandles } from "./core/handles";
import type { ProcessDeps, ProcessStartPort, StageLauncher } from "./core/ports";
import { ThreadPoster } from "./core/thread-poster";
import { defsRoutes } from "./defs/defs.routes";
import { gatesRoutes } from "./gates/gates.routes";
import { inboxRoutes } from "./notify/inbox.routes";
import { createNotifier } from "./notify/notifier";
import { remindOnce } from "./notify/reminder";
import { conversationStart } from "./runs/conversation-start";
import { createStageLauncher } from "./runs/launcher";
import { roomStart } from "./runs/room-start";
import { processRunsRoutes } from "./runs/runs.routes";
import { sweepOnce } from "./runs/sweeps";
import { usageRoutes } from "./usage/usage.routes";

/** Gốc route quy trình cần JWT (`app.ts` gắn `requireAuth`; `/me/*` đã có ở X2a). */
export const PROCESS_PROTECTED_PREFIXES = [
  "/processes",
  "/process-runs",
  "/review-tasks",
  "/process-defs",
  "/agent-teams",
] as const;

/** Seam test (plan-contract §7.1): vắng ⇒ hành vi chạy thật. */
export type ProcessSeams = {
  processRunsPerTenant?: number;
  stageLauncher?: StageLauncher;
  now?: Clock;
  /** false ⇒ không chạy vòng nền (test gọi `*Once` qua handles). */
  processLoops?: boolean;
  onProcessHandles?: (h: ProcessHandles) => void;
};
export type ProcessMountDeps = Omit<
  ProcessDeps,
  "now" | "runsPerTenant" | "launcher" | "notifier" | "postThread" | "start"
> &
  ProcessSeams;
/** Điểm nối vào route có sẵn: `!` ở phòng (X2a/X2b) + Hỏi AI (C1). */
export type ProcessMounted = { roomSender: RoomProcessSender; conversationStart: ProcessStartPort };

export function mountProcesses<E extends Env>(app: Hono<E>, m: ProcessMountDeps): ProcessMounted {
  const poster = new ThreadPoster(m);
  const base: Omit<ProcessDeps, "start" | "launcher"> = {
    ...m,
    now: clockOf(m.now),
    runsPerTenant: m.processRunsPerTenant ?? PROCESS_RUNS_PER_TENANT,
    notifier: createNotifier(),
    postThread: (runId) => poster.post(runId),
  };
  // Launcher thật nhận `ProcessDeps` (RunService/runner) để tạo `hub.runs` stage; test có thể thay `stageLauncher` giả.
  const launcher = m.stageLauncher ?? createStageLauncher(base);
  const core: Omit<ProcessDeps, "start"> = { ...base, launcher };
  const d: ProcessDeps = { ...core, start: conversationStart(core) };
  for (const r of [
    processRunsRoutes,
    gatesRoutes,
    asksRoutes,
    inboxRoutes,
    usageRoutes,
    defsRoutes,
  ])
    app.route("/", r(d));
  m.onProcessHandles?.({
    sweepOnce: () => sweepOnce(d),
    remindOnce: () => remindOnce(d),
    postThreadOnce: () => poster.postThreadOnce(),
    kick: (runId) => d.launcher.kick(runId),
  });
  if (m.processLoops !== false) poster.start(m.signal);
  return { roomSender: roomStart(d), conversationStart: d.start };
}
