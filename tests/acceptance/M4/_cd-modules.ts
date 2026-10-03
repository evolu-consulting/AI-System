// ADM-FR-08, ADM-FR-54 · nạp động module sản phẩm khối C + D (như M1–M3 `_modules.ts`): Q2 viết test TRƯỚC code,
// import tĩnh module chưa có làm vỡ `bun run typecheck`. Chỉ dùng chữ ký ở plan-cd §3, §4, §6, §9.
// Không phụ thuộc DB/env (file luật thuần dùng được).
import { join } from "node:path";
import { type Loose, ROOT } from "../M1/_modules";

export type { Loose };

const load = (rel: string): Promise<Loose> => import(join(ROOT, rel));

export const loadTotpLib = () => load("apps/admin-api/src/lib/totp.ts");
export const loadTotpRules = () => load("apps/admin-api/src/modules/auth/totp/totp.rules.ts");
export const loadTransferRules = () =>
  load("apps/admin-api/src/modules/transfer/transfer.rules.ts");
export const loadMailer = () => load("apps/admin-api/src/lib/mailer/index.ts");
/** Contract mới (plan-cd §3, §4): `packages/contracts/src/{transfer,totp}.ts`. */
export const loadTransferContract = () => load("packages/contracts/src/transfer.ts");
export const loadTotpContract = () => load("packages/contracts/src/totp.ts");
