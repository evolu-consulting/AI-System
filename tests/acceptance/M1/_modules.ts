// ADM-FR-01 · nạp động module sản phẩm cho test M1. Q2 viết test TRƯỚC code: module chưa có thì import tĩnh
// làm vỡ `bun run typecheck` (tsconfig.tests.json gồm tests/**). Import động theo chuỗi → kiểu lỏng, và
// test đỏ lúc chạy ("Cannot find module") cho tới khi task tương ứng xong. Chỉ dùng chữ ký ở plan.md §4, §10.
import { join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dir, "../../..");

// biome-ignore lint/suspicious/noExplicitAny: module chưa tồn tại khi viết test (xem comment đầu file)
export type Loose = Record<string, any>;

const load = (rel: string): Promise<Loose> => import(join(ROOT, rel));
const bare = (spec: string): Promise<Loose> => import(spec);

export const loadAuthRules = () => load("apps/admin-api/src/modules/auth/auth.rules.ts");
export const loadUsersRules = () => load("apps/admin-api/src/modules/users/users.rules.ts");
export const loadTenantsRules = () => load("apps/admin-api/src/modules/tenants/tenants.rules.ts");
export const loadApp = () => load("apps/admin-api/src/app.ts");
export const loadJwt = () => load("apps/admin-api/src/lib/jwt.ts");
export const loadDbGuard = () => load("apps/admin-api/src/lib/db-guard.ts");
export const loadSeed = () => bare("@ai/db/seed");
