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
import { featureKeyView } from "../access/access.service";
import * as repo from "./app-catalog.repo";
import {
  type CatalogRow,
  chatAllowed,
  needsFeatures,
  redeemTargetOk,
  type Viewer,
  visibleApps,
} from "./app-catalog.rules";

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

/** Catalog + người xem (feature hiệu lực / tenant được cấp / đang có) — một lượt đọc quyền. */
async function catalogView(tx: Tx, actor: Actor): Promise<{ rows: CatalogRow[]; viewer: Viewer }> {
  const rows = await repo.listAll(tx);
  if (!needsFeatures(rows, actor.role))
    return { rows, viewer: { role: actor.role, features: new Set<string>() } };
  const k = await featureKeyView(tx, actor);
  return {
    rows,
    viewer: {
      role: actor.role,
      features: k.effective,
      tenantFeatures: k.tenant,
      knownFeatures: k.known,
    },
  };
}

export async function openableIn(tx: Tx, actor: Actor): Promise<CatalogRow[]> {
  const { rows, viewer } = await catalogView(tx, actor);
  return visibleApps(rows, viewer);
}

/** app-perm · app mở được + Chat AI có dùng được không (theo quyền, bỏ qua URL) — cho `GET /me/portal`. */
export async function portalAppsIn(
  tx: Tx,
  actor: Actor,
): Promise<{ apps: CatalogRow[]; chat: boolean }> {
  const { rows, viewer } = await catalogView(tx, actor);
  return { apps: visibleApps(rows, viewer), chat: chatAllowed(rows, viewer) };
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
