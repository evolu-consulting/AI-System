// ADM-FR-62, ADM-FR-32, ADM-FR-36, ADM-FR-53 · nạp động module sản phẩm cho test M3 (như M1/M2 `_modules.ts`):
// Q2 viết test TRƯỚC code, import tĩnh làm vỡ `bun run typecheck`. Chỉ dùng chữ ký ở plan.md §4, §5.2.
import { join } from "node:path";
import { type Loose, ROOT } from "../M1/_modules";

export { type Loose, ROOT };

const load = (rel: string): Promise<Loose> => import(join(ROOT, rel));

export const loadGroupsRules = () => load("apps/admin-api/src/modules/groups/groups.rules.ts");
export const loadGrantsRules = () => load("apps/admin-api/src/modules/grants/grants.rules.ts");
export const loadAccessRules = () => load("apps/admin-api/src/modules/access/access.rules.ts");
