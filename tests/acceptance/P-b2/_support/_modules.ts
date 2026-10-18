// HUB-FR-104 · HUB-FR-106 · HUB-FR-118 · HUB-FR-136 · P-b2 (test-plan §0): nạp ĐỘNG module sản phẩm theo đường dẫn ĐÃ KẾ
// HOẠCH (plan §1.2, §2, §4.1–§4.2) — mẫu `P-a/_support/modules.ts`. Test viết TRƯỚC code ⇒ import tĩnh file chưa có làm vỡ
// `bun run typecheck`; module vắng ⇒ `{}` ⇒ ca đỏ ở `fn(...)` (`expect(typeof f).toBe("function")`), không đỏ ở import.
import { fn, type Loose, loadChat, loadHubAdmin, loadProcRules } from "../../P-a/_support/modules";

export { fn, type Loose, loadChat, loadHubAdmin };

/** `domain/runs/step.rules.ts` (T5a; chuyển T8s): `stageIdxsOfStep`, `stepCountOf`, `firstIdxOfStep`, `priorStageIdxs`, `stageGateStatus`,
 * `runStatusOf`, `stepJoin`, `pickDecisionStage`, `realActionStepCheck`. */
export const loadStepRules = (): Promise<Loose> => loadProcRules("domain/runs/step.rules.ts");
/** `domain/gates/back.rules.ts` (T6; chuyển T8s): `backDecisionCheck`, `backAllowed`, `backRoundsLeft`, `backResetPlan`. */
export const loadBackRules = (): Promise<Loose> => loadProcRules("domain/gates/back.rules.ts");
/** `runs/handoff.rules.ts` (T7): `handoffBlock`. */
export const loadHandoffRules = (): Promise<Loose> => loadProcRules("runs/handoff.rules.ts");
/** `runs/session.rules.ts` (T7): `sessionPlan`, `deltaPrompt`, `SESSION_RESUME_MAX_AGE_S`. */
export const loadSessionRules = (): Promise<Loose> => loadProcRules("runs/session.rules.ts");
/** `defs/def.rules.ts` (đã có từ P-a; T3 thêm `ensureHandoff`). */
export const loadDefRules = (): Promise<Loose> => loadProcRules("defs/def.rules.ts");
