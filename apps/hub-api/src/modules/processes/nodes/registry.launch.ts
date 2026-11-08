// CR-103 · R1 fnr-registry · design §1: registry phần CHẠY của loại node (launcher gọi `nodeLauncherOf(kind)`).
// Tách khỏi `registry.ts` để luật thuần (`defs/def.rules`) không kéo theo DB/driver.
import type { ExecutorKind } from "@ai/contracts/hub-admin";
import type { NodeLauncher } from "../runs/launch-common";
import { agentLauncher } from "./agent/launch";
import { applyLauncher } from "./apply/launch";
import { approveLauncher } from "./approve/launch";
import { formLauncher } from "./form/launch";
import { ifLauncher } from "./if/launch";
import { notifyLauncher } from "./notify/launch";
import { setLauncher } from "./set/launch";
import { subprocessLauncher } from "./subprocess/launch";
import { teamLauncher } from "./team/launch";
import { toolLauncher } from "./tool/launch";
import { waitEventLauncher } from "./wait-event/launch";
import { waitForLauncher } from "./wait-for/launch";
import { waitUntilLauncher } from "./wait-until/launch";

/** Mọi loại trong union contract PHẢI có launcher (thiếu ⇒ lỗi typecheck). */
export const NODE_LAUNCHERS: Readonly<Record<ExecutorKind, NodeLauncher>> = {
  agent: agentLauncher,
  team: teamLauncher,
  apply: applyLauncher,
  wait_until: waitUntilLauncher,
  tool: toolLauncher,
  set: setLauncher,
  if: ifLauncher,
  form: formLauncher,
  wait_for: waitForLauncher,
  wait_event: waitEventLauncher,
  notify: notifyLauncher,
  approve: approveLauncher,
  subprocess: subprocessLauncher,
};

/** CR-125 · «Quy trình con»: pha chốt trong `finishWait` + lượt con cần huỷ theo cha (lõi gọi qua registry, không import `nodes/<kind>`). */
export { subprocessWaitOut } from "./subprocess/settle";
export { liveChildren as liveChildRuns } from "./subprocess/subprocess.repo";

export const nodeLauncherOf = (kind: ExecutorKind): NodeLauncher => NODE_LAUNCHERS[kind];
