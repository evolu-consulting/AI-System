// HUB-FR-105 · HUB-FR-106 · PF1 · `GET /processes`, `POST/GET /process-runs*`, `/outputs/:oid`, `cancel`, `decide` (plan §9,
// plan-contract §3). Bước 0: khung rỗng (mount sẵn ⇒ PF1 chỉ sửa file này, không đụng `processes.mount.ts`).
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import type { ProcessDeps } from "../core/ports";

export function processRunsRoutes(_d: ProcessDeps): Hono<AuthVars> {
  return new Hono<AuthVars>();
}
