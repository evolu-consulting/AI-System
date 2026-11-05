// CR-120 · G3/G4 · luật def dùng chung của stage `wait_for` / `wait_event` (Hub chờ bằng hẹn giờ, không agent, không output
// field; ép trường qua `ensureWaitStage`). Thuần. WAIT_INVALID: `after` ≠ auto (path `stages.i.after`) | real_action / sources /
// must_know / autofix (path `stages.i.executor`) | `wait_event`: khoá sự kiện trùng trong cùng def (`stages.i.executor.event`).
import type { ProcessDefInput } from "@ai/contracts/hub-admin";
import type { DefIssue, DefStage } from "../types";

const hasExtra = (s: DefStage): boolean =>
  s.real_action ||
  (s.sources?.length ?? 0) > 0 ||
  (s.must_know?.length ?? 0) > 0 ||
  (s.autofix ?? null) !== null;

function stageIssues(s: DefStage, i: number, events: Set<string>): DefIssue[] {
  const out: DefIssue[] = [];
  if (s.after.kind !== "auto") out.push({ path: `stages.${i}.after`, rule: "WAIT_INVALID" });
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
  return d.stages.flatMap((s, i) =>
    s.executor.kind === "wait_for" || s.executor.kind === "wait_event"
      ? stageIssues(s, i, events)
      : [],
  );
}
