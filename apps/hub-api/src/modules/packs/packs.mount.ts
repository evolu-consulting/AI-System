// PK-FR-05 · PK-FR-09 · D-09 · N1 plan §9 · lớp 4 của module gói (gộp mount tối thiểu T5b `app.packs.ts`): `GET /pack/<k>/me`
// + route nghiệp vụ từng gói dưới `/pack/<k>`. Chỗ DUY NHẤT nối `modules/config` (ConfigCache thoả cổng `PackAccessView`) vào
// module gói. JWT ở gốc: `PACK_PREFIX` nằm trong `PROTECTED_PREFIXES` của `app.ts` (401 trước 404). Gói `pkdemo` (D-08) chỉ
// ngoài production: `deps.packs.pkdemo` ưu tiên, vắng ⇒ `appEnv !== "production"`.
import type { Db } from "@ai/db";
import type { Env, Hono } from "hono";
import type { ConfigCache } from "../config/config.service";
import { packMeRoutes } from "./kit/adapters/me.route";
import type { PackAccessView } from "./kit/adapters/pack-guard.middleware";
import { PKDEMO_KEY, pkdemoModule } from "./pkdemo/pkdemo.mount";

export const PACK_PREFIX = "/pack";

/** Seam `AppDeps.packs` (test ↔ hub-api). `filebox` dành cho T5f (FileBox `org` theo tenant). */
export type PacksDeps = { pkdemo?: boolean; filebox?: { url: string; token: string } };

export type PacksMountDeps = {
  db?: Db;
  config: ConfigCache;
  appEnv?: "development" | "test" | "production";
  packs?: PacksDeps;
};

/** Gắn `/pack/*` (gọi sau khi đã gắn `requireAuth`); trả cổng quyền gói. */
export function mountPacks<E extends Env>(app: Hono<E>, d: PacksMountDeps): PackAccessView {
  const view: PackAccessView = d.config;
  app.route(PACK_PREFIX, packMeRoutes(view));
  const pkdemoOn = d.packs?.pkdemo ?? (d.appEnv ?? process.env.APP_ENV) !== "production";
  if (d.db && pkdemoOn) app.route(`${PACK_PREFIX}/${PKDEMO_KEY}`, pkdemoModule(d.db, view));
  return view;
}
