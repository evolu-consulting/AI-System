// CR-102 · com-c3 · `/pack/community/viewer|partners|cats|profile|settings|notifications`. `GET /viewer` thay `/me` của C5 vì
// `/pack/:k/me` (kit) đã chiếm đường dẫn. Đối tác: chỉ công ty mình + hồ sơ chủ quản (HT-71/73/74); quản trị nhãn chỉ Admin
// chủ quản (HT-82). Thông báo = C9 (ở đây trả rỗng).
import {
  type CommunitySettings,
  CommunitySettingsSchema,
  type CommunityViewer,
  DEFAULT_SETTINGS,
  PartnerUpdateInputSchema,
  type Profile,
} from "@ai/contracts/community";
import { type Context, Hono } from "hono";
import { AppError, appError } from "../../../../lib/errors";
import { parseWith, readJson } from "../../../../lib/http";
import type { PackGuardVars } from "../../kit/adapters/pack-guard.middleware";
import { bellView } from "../domain/notify.rules";
import { type Access, accessOf } from "./community-access";
import type { CommunityDeps } from "./community-deps";
import * as orgs from "./org.service";
import { partnerViews } from "./views";

type R = Hono<PackGuardVars>;
type Acc = (c: Context<PackGuardVars>, need?: "read" | "write") => Promise<Access>;

/** Hồ sơ được xem: chủ quản = mọi bên; đối tác = công ty mình + chủ quản. `null` = chủ quản | id công ty | undefined (404). */
function profileTarget(a: Access, orgId: string | undefined): string | null | undefined {
  const id = orgId ?? a.org ?? a.who.tenantId;
  if (id === a.who.tenantId) return null;
  if (!a.dir.orgs.some((o) => o.id === id)) return undefined;
  return a.org === null || id === a.org ? id : undefined;
}

async function profileOf(d: CommunityDeps, a: Access, orgId: string | undefined): Promise<Profile> {
  const target = profileTarget(a, orgId);
  if (target === undefined) throw appError("NOT_FOUND");
  const { stats, rows } = await orgs.profile(d.uow, a, target);
  const hostView = a.org === null;
  if (target === null)
    return {
      org: {
        id: a.who.tenantId,
        name: a.dir.tenantName,
        labels: [],
        cats: [],
        isHost: true,
        blurb: "",
      },
      stats: {
        ...stats,
        ...(hostView ? { friends: a.dir.orgs.filter((o) => o.active).length } : {}),
      },
      ...(hostView ? { shtUrl: d.shtUrl } : {}),
    };
  const org = partnerViews(a, rows).find((p) => p.id === target);
  if (!org) throw appError("NOT_FOUND");
  return { org: { ...org, isHost: false, blurb: "" }, stats };
}

function viewerAndPartners(r: R, d: CommunityDeps, access: Acc): void {
  r.get("/viewer", async (c) => {
    const a = await access(c);
    const me = await orgs.own(d.uow, a);
    const v: CommunityViewer = {
      userId: a.who.userId,
      name: a.dir.userName,
      role: a.org !== null ? "partner" : a.isAdmin ? "host_admin" : "host_member",
      orgId: a.org ?? a.who.tenantId,
      orgName:
        a.org === null ? a.dir.tenantName : (a.dir.orgs.find((o) => o.id === a.org)?.name ?? ""),
      labels: me?.labels ?? [],
      cats: me?.cats ?? [],
    };
    return c.json(v);
  });
  r.get("/partners", async (c) => {
    const a = await access(c);
    return c.json(partnerViews(a, await orgs.partners(d.uow, a)));
  });
  r.put("/partners/:orgId", async (c) => {
    const a = await access(c, "write");
    if (a.org !== null || !a.isAdmin) throw new AppError("PACK_FORBIDDEN", 403, "Forbidden");
    const org = c.req.param("orgId");
    if (!a.dir.orgs.some((o) => o.id === org)) throw appError("NOT_FOUND");
    const p = parseWith(PartnerUpdateInputSchema, await readJson(c));
    const rows = await orgs.savePartner(d.uow, a, org, p);
    return c.json(partnerViews(a, rows).find((x) => x.id === org));
  });
  r.get("/cats", async (c) => c.json(await orgs.cats(d.uow, await access(c))));
  r.get("/profile", async (c) => c.json(await profileOf(d, await access(c), undefined)));
  r.get("/profile/:orgId", async (c) =>
    c.json(await profileOf(d, await access(c), c.req.param("orgId"))),
  );
}

function settingsAndNotifications(r: R, d: CommunityDeps, access: Acc): void {
  r.get("/settings", async (c) => {
    const row = await orgs.settings(d.uow, await access(c));
    const s = row
      ? CommunitySettingsSchema.safeParse({
          accent: row.accent,
          notify: { ...DEFAULT_SETTINGS.notify, ...row.notify },
        })
      : null;
    return c.json(s?.success ? s.data : DEFAULT_SETTINGS);
  });
  r.put("/settings", async (c) => {
    const a = await access(c);
    const s: CommunitySettings = parseWith(CommunitySettingsSchema, await readJson(c));
    await orgs.putSettings(d.uow, a, s);
    return c.json(s);
  });
  // C9 · chuông kit của chính người dùng (nguồn `community`); `/read` không `id` = đọc hết.
  r.get("/notifications", async (c) => {
    const a = await access(c);
    const { items, unread } = await d.bell.list(a.who, 50);
    return c.json({ items: items.flatMap((x) => bellView(x) ?? []), unread });
  });
  r.post("/notifications/read", async (c) => {
    const a = await access(c);
    const b = (await c.req.json().catch(() => ({}))) as { id?: unknown };
    await d.bell.markRead(a.who, typeof b.id === "string" ? b.id : undefined);
    return c.body(null, 204);
  });
}

export function orgRoutes(d: CommunityDeps): R {
  const r = new Hono<PackGuardVars>();
  const access: Acc = (c, need = "read") => accessOf(d.view, d.resolver, c, need);
  viewerAndPartners(r, d, access);
  settingsAndNotifications(r, d, access);
  return r;
}
