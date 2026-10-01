// ADM-FR-10, ADM-FR-50 · nạp động module sản phẩm cho test M2 (như M1/_modules.ts): Q2 viết test TRƯỚC code, import tĩnh
// làm vỡ `bun run typecheck`. Chỉ dùng chữ ký ở plan.md §3.2, §4.
import { join } from "node:path";
import { type Loose, ROOT } from "../M1/_modules";

export { type Loose, ROOT };

const load = (rel: string): Promise<Loose> => import(join(ROOT, rel));

export const loadSecretCrypto = () => load("apps/admin-api/src/lib/secret-crypto.ts");
export const loadSecretsRules = () => load("apps/admin-api/src/modules/secrets/secrets.rules.ts");
export const loadWorkflowsRules = () =>
  load("apps/admin-api/src/modules/workflows/workflows.rules.ts");
export const loadCommandsRules = () =>
  load("apps/admin-api/src/modules/commands/commands.rules.ts");
export const loadFeaturesRules = () =>
  load("apps/admin-api/src/modules/features/features.rules.ts");
