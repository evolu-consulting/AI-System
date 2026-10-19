// PK-FR-09 · D-08 · N1 plan §9: nối gói `pkdemo` (lớp 4 của gói): `PackUow` (role `pkdemo_rw`) + use case + route. Id sinh
// UUIDv7 (tăng dần trong tiến trình ⇒ thứ tự dòng = thứ tự id). Chỉ mount ngoài production (`packs.mount.ts` quyết).
// N2-FR-01: route khởi chạy run qua cầu `PackRuns`; N2-FR-03: đăng ký tool mẫu vào registry tool gói.
import type { Db } from "@ai/db";
import type { Hono } from "hono";
import { logger } from "../../../lib/logger";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow, packTenantOnly } from "../kit/adapters/pack-uow";
import type { PackRunsBridge } from "../kit/application/pack-runs.ports";
import type { PackToolDef } from "../kit/application/pack-tools.ports";
import { pkdemoRepos } from "./adapters/items.repo";
import { PKDEMO_KEY, pkdemoRoutes } from "./adapters/pkdemo.routes";
import { pkdemoTools } from "./adapters/pkdemo.tools";
import { createItem } from "./application/create-item.usecase";
import { getItem } from "./application/get-item.usecase";
import { itemRunOutcome, startItemRun } from "./application/start-item-run.usecase";

export { PKDEMO_KEY };

/** Phần nối N2: cầu `PackRuns` (vắng / engine tắt ⇒ 503 PROCESS_ENGINE_OFF) + nơi đăng ký tool gói (vắng ⇒ không tool). */
export type PkdemoN2 = { runs?: PackRunsBridge; tools?: { register(t: PackToolDef): void } };

export function pkdemoModule(db: Db, view: PackAccessView, n2: PkdemoN2 = {}): Hono<PackGuardVars> {
  const uow = packTenantOnly(createPackUow(db, PKDEMO_KEY, pkdemoRepos));
  const newId = () => Bun.randomUUIDv7();
  const warn = (msg: string, meta: Record<string, unknown>) => logger.warn(msg, meta);
  if (n2.tools) for (const t of pkdemoTools(uow, newId)) n2.tools.register(t);
  return pkdemoRoutes(view, {
    create: createItem({ uow, newId }),
    get: getItem({ uow }),
    run: startItemRun({ bridge: n2.runs ?? {}, uow, warn }),
    outcome: itemRunOutcome({ bridge: n2.runs ?? {}, uow, warn }),
  });
}
