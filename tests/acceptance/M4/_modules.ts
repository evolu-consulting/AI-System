// ADM-FR-40, ADM-FR-41, ADM-FR-42, ADM-FR-51, ADM-FR-52 · nạp động module sản phẩm khối A + B (như M1–M3 `_modules.ts`):
// Q2 viết test TRƯỚC code, import tĩnh module chưa có làm vỡ `bun run typecheck` → đỏ lúc chạy ("Cannot find module")
// tới khi task tương ứng xong. Chỉ dùng chữ ký ở plan-rules.md §A1–A5 và plan-cd §9 (mailer). Không phụ thuộc DB/env.
// Khối C + D nạp module riêng ở `_cd-modules.ts`.
import { join } from "node:path";
import { type Loose, ROOT } from "../M1/_modules";

export { type Loose, ROOT };

const load = (rel: string): Promise<Loose> => import(join(ROOT, rel));

/** plan-rules §A1: `AUDIT_FIELDS`, `FORBIDDEN_AUDIT_KEYS`, `USER_DEFINED_AUDIT_FIELDS`, `auditSnapshot`, `containsForbiddenKey`. */
export const loadAuditSnapshot = () => load("apps/admin-api/src/lib/audit/audit.rules.ts");
/** plan-rules §A2–A3: `resolveAuditFilter`, `canRestore`, `encodeCursor`, `decodeCursor`, `restoreCheck`. */
export const loadAuditRules = () => load("apps/admin-api/src/modules/audit/audit.rules.ts");
/** plan-rules §A4. */
export const loadQuotasRules = () => load("apps/admin-api/src/modules/quotas/quotas.rules.ts");
/** plan-rules §A5. */
export const loadUsageRules = () => load("apps/admin-api/src/modules/usage/usage.rules.ts");
/** plan-cd §9: `createMemoryMailer`, `MailError` (khối A inject `deps.mailer`). */
export const loadMailerLib = () => load("apps/admin-api/src/lib/mailer/index.ts");
