// CR-120 · G3/G4 · luật def dùng chung của stage `wait_for` / `wait_event` (Hub chờ bằng hẹn giờ, không agent, không output
// field; ép trường qua `ensureWaitStage`). Thuần. WAIT_INVALID: `after` ≠ auto (trừ Xác nhận mốc) (path `stages.i.after`) | real_action / sources /
// must_know / autofix (path `stages.i.executor`) | `wait_event`: khoá sự kiện trùng trong cùng def (`stages.i.executor.event`).
import { type ProcessDefInput, resolveSteps } from "@ai/contracts/hub-admin";
import type { DefIssue, DefStage } from "../types";

const hasExtra = (s: DefStage): boolean =>
  s.real_action ||
  (s.sources?.length ?? 0) > 0 ||
  (s.must_know?.length ?? 0) > 0 ||
  (s.autofix ?? null) !== null;

/** CR-122 E3b · `branches`: `on` ∈ khoá chờ (`event` + `also_events`) hoặc `timeout`; đích là bước có thật SAU bước của mình. */
function branchIssues(s: DefStage, i: number, steps: readonly number[]): DefIssue[] {
  const e = s.executor;
  if (e.kind !== "wait_event" || !e.branches) return [];
  const keys = new Set([e.event, ...(e.also_events ?? []), "timeout"]);
  const own = steps[i] as number;
  const has = new Set(steps);
  return e.branches.flatMap((b, j) =>
    keys.has(b.on) && b.goto_step > own && has.has(b.goto_step)
      ? []
      : [{ path: `stages.${i}.executor.branches.${j}`, rule: "WAIT_INVALID" as const }],
  );
}

/** CR-127 · E10a · node «Xác nhận mốc» (chờ của việc nhóm) mang cấu hình giao việc ở `after` kiểu Duyệt (Ai làm / Cần / Quá hạn /
 *  Nhắc — engine đọc ở `openMilestoneTask`; người/phòng kiểm cùng tenant như khối Duyệt ở `stageRefMiss`). Bước chờ khác: `auto`. */
export const MILESTONE_CONFIRM_NODE_KEY = "contracts.milestone-confirm";
const afterOk = (s: DefStage): boolean =>
  s.after.kind === "auto" ||
  (s.node === MILESTONE_CONFIRM_NODE_KEY && s.executor.kind === "wait_event");

function stageIssues(s: DefStage, i: number, events: Set<string>): DefIssue[] {
  const out: DefIssue[] = [];
  if (!afterOk(s)) out.push({ path: `stages.${i}.after`, rule: "WAIT_INVALID" });
  if (hasExtra(s)) out.push({ path: `stages.${i}.executor`, rule: "WAIT_INVALID" });
  if (s.executor.kind === "wait_event") {
    if (events.has(s.executor.event))
      out.push({ path: `stages.${i}.executor.event`, rule: "WAIT_INVALID" });
    events.add(s.executor.event);
  }
  return out;
}

export function timedWaitDefIssues(d: ProcessDefInput): DefIssue[] {
  const events = new Set<string>();
  const steps = resolveSteps(d.stages);
  return d.stages.flatMap((s, i) =>
    s.executor.kind === "wait_for" || s.executor.kind === "wait_event"
      ? [...stageIssues(s, i, events), ...branchIssues(s, i, steps)]
      : [],
  );
}
