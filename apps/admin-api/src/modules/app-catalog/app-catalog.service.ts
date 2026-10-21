// app-catalog · CRUD platform_admin (`/admin/apps`), `GET /me/apps` (lọc theo vai + feature hiệu lực), đích SSO và seed URL.
// Quyền feature dùng lại `computeEffectiveAccess` (cùng nguồn với effective-access/Hub) — không tự chế luật.
import type {
  AppCatalogItem,
  AppCatalogListResponse,
  AppCreateRequest,
  AppUpdateRequest,
  MeApp,
  MyAppsResponse,
} from "@ai/contracts";
import { type Db, type Tx, withScope } from "@ai/db";
import { type Actor, scopeOf } from "../../lib/auth-middleware";
import { appError } from "../../lib/errors";
import { effectiveFeatureKeys } from "../access/access.service";
import * as repo from "./app-catalog.repo";
import { type CatalogRow, needsFeatures, redeemTargetOk, visibleApps } from "./app-catalog.rules";

export type AppCatalogCtx = { db: Db };

const toItem = (r: repo.CatalogDbRow): AppCatalogItem => ({
  key: r.key,
  name: r.name,
  icon: r.icon,
  url: r.url,
  audience: r.audience,
  required_feature: r.requiredFeature,
  sso: r.sso,
  sort_order: r.sortOrder,
  enabled: r.enabled,
  version: r.version,
  updated_at: r.updatedAt.toISOString(),
});

export function listApps(ctx: AppCatalogCtx, actor: Actor): Promise<AppCatalogListResponse> {
  return withScope(ctx.db, scopeOf(actor), async (tx) => ({
    items: (await repo.listAll(tx)).map(toItem),
  }));
}

export function createApp(
  ctx: AppCatalogCtx,
  actor: Actor,
  b: AppCreateRequest,
): Promise<AppCatalogItem> {
  return withScope(ctx.db, scopeOf(actor), async (tx) => {
    const row = await repo.insert(tx, b, actor.userId);
    if (!row) throw appError("KEY_TAKEN");
    return toItem(row);
  });
}

export function updateApp(
  ctx: AppCatalogCtx,
  actor: Actor,
  key: string,
  b: AppUpdateRequest,
): Promise<AppCatalogItem> {
  return withScope(ctx.db, scopeOf(actor), async (tx) => {
    const row = await repo.update(tx, key, b, actor.userId);
    if (!row) throw appError("NOT_FOUND");
    return toItem(row);
  });
}

export function deleteApp(ctx: AppCatalogCtx, actor: Actor, key: string): Promise<void> {
  return withScope(ctx.db, scopeOf(actor), async (tx) => {
    if (!(await repo.remove(tx, key))) throw appError("NOT_FOUND");
  });
}

async function openableIn(tx: Tx, actor: Actor): Promise<CatalogRow[]> {
  const rows = await repo.listAll(tx);
  const features = needsFeatures(rows, actor.role)
    ? await effectiveFeatureKeys(tx, actor)
    : new Set<string>();
  return visibleApps(rows, { role: actor.role, features });
}

const toMeApp = (r: CatalogRow): MeApp => ({
  key: r.key,
  name: r.name,
  icon: r.icon,
  url: r.url,
  sso: r.sso,
});

/** `GET /me/apps`: app người gọi được mở. Cô lập tenant do RLS của bảng quyền (scope tenant của chính người gọi). */
export function myApps(ctx: AppCatalogCtx, actor: Actor): Promise<MyAppsResponse> {
  return withScope(ctx.db, scopeOf(actor), async (tx) => ({
    items: (await openableIn(tx, actor)).map(toMeApp),
  }));
}

/** Đích SSO cho `POST /auth/sso/code`: app phải mở được với người gọi, có SSO ⇒ URL catalog; ngược lại 403. */
export function ssoTarget(ctx: AppCatalogCtx, actor: Actor, app: string): Promise<string> {
  return withScope(ctx.db, scopeOf(actor), async (tx) => {
    const hit = (await openableIn(tx, actor)).find((r) => r.key === app && r.sso);
    if (!hit) throw appError("FORBIDDEN");
    return hit.url;
  });
}

/** Đổi mã SSO (trong tx của đổi mã): app đích còn bật + có SSO + `Origin` khớp URL catalog. */
export async function redeemTargetAllowed(
  tx: Tx,
  app: string,
  origin: string | undefined,
): Promise<boolean> {
  return redeemTargetOk((await repo.findOne(tx, app)) ?? undefined, origin);
}
