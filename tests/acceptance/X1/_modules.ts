// X1-AC03, AC06, AC07, AC11, AC15, AC16, AC17, AC19 · nạp động module sản phẩm X1 (mẫu M1/M4 `_modules.ts`, test-plan P7):
// test viết TRƯỚC code ⇒ import tĩnh file chưa có làm vỡ `bun run typecheck`. Import động theo chuỗi → kiểu lỏng,
// ca đỏ lúc chạy ("Cannot find module"/thiếu export) tới khi task tương ứng xong. Chỉ dùng chữ ký ở plan.md §2.2,
// §2.3, §5.2; plan-frontend.md §1.1b; plan-stack.md. Không phụ thuộc DB/env.
import { join } from "node:path";
import { type Loose, ROOT } from "../M1/_modules";

export { type Loose, ROOT };

const load = (rel: string): Promise<Loose> => import(join(ROOT, rel));

/** plan-frontend §1.1b AC03: `buildSendRequest({content, flowId?, context?, attachmentIds?})`. */
export const loadSendRequest = () =>
  load("apps/chat-web/src/features/run/lib/send-request.rules.ts");
/** plan-frontend §1.1b AC06: `applyDelta(state: RunState, delta: DeltaData): RunState`. */
export const loadDelta = () => load("apps/chat-web/src/features/run/lib/delta.rules.ts");
/** `createRunState` (có sẵn, C1) — dựng RunState cho AC06. */
export const loadRunReducer = () => load("apps/chat-web/src/features/run/lib/reducer.ts");
/** plan-frontend §1.1b AC07: `validateAttachment(file, existing)` → `{ok} | {error}`. */
export const loadAttachValidate = () =>
  load("apps/chat-web/src/features/attachments/lib/validate.rules.ts");
/** plan §2.2: `testRunPrecheck`, `mapHubTestRun`. */
export const loadCommandTestRules = () =>
  load("apps/admin-api/src/modules/commands/commands.test-run.rules.ts");
/** plan §2.2: `CommandTestRequestSchema`, `CommandTestResponseSchema`, `COMMAND_TEST_ERRORS`, `SideEffectConfirmDetailsSchema`. */
export const loadCommandTestContract = () => load("packages/contracts/src/command-test.ts");
/** plan §2.3: `REQUIRED_ADMIN_COLUMNS`, `missingAdminColumns(db)`. */
export const loadSchemaCheck = () => load("apps/hub-api/src/modules/config/schema-check.ts");
/** plan §5.2: `SEED_APPS`, `ENV_KEY`, `parseSeedEnv`, `parseSeedArgs`, `buildSeedPlan`, `workflowPatch`, `commandPatch`, `formatPlan`. */
export const loadSeedRules = () => load("tools/scripts/src/seed-dify-live.rules.ts");
/** plan-stack.md: `ProcName`, `START_ORDER`, `buildCombineEnv`, `stopOrder`. */
export const loadCombineRules = () => load("tools/scripts/src/combine.rules.ts");
/** M1/M4: `AUDIT_FIELDS` (plan §2.1: thêm `side_effect` vào `workflow`). */
export const loadAuditFields = () => load("apps/admin-api/src/lib/audit/audit.rules.ts");
