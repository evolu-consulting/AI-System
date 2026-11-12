// CR-122 · E1 / CR-127 · E6b (tách khỏi defs.service.ts cho ≤ 400 dòng): luật FlowDef khi lưu def có `trigger`.
import type { ProcessDefInput } from "@ai/contracts/hub-admin";
import { claimError } from "../core/errors";
import { triggerParamIssue } from "../triggers/schedule.rules";
import { defError } from "./defs.map";
import type * as repo from "./defs.repo";
import { flowDefPaths } from "./flow-def.rules";

/** CR-122 · E1 · def có `trigger` ⇒ luật FlowDef (422 `PROCESS_DEF_INVALID`, `paths`). */
export function flowCheck(
  input: ProcessDefInput,
  tenantId: string | null,
  cur: repo.DefRow | null,
): void {
  const range = triggerParamIssue(input.trigger); // CR-127 · E6b · N ngày ngoài khoảng manifest ⇒ 422
  if (range) throw claimError("TRIGGER_PARAM_RANGE", range);
  const paths = flowDefPaths(input, tenantId, cur);
  if (paths.length > 0) throw defError("PROCESS_DEF_INVALID", { paths });
}
