// CR-102 · com-c3 · `/pack/community/viewer|partners|cats|profile|settings|notifications`. `GET /viewer` thay `/me` của C5 vì
// `/pack/:k/me` (kit) đã chiếm đường dẫn. Đối tác: chỉ công ty mình + hồ sơ chủ quản (HT-71/73/74); vai/nhóm hàng của đối tác
// quản ở SHT › Đối tác (CR-130, ADR-0043) — không còn `PUT /partners/:orgId`. Thông báo = C9 (ở đây trả rỗng).
import {
  COMMUNITY_BRAND_ACCENTS,
  type CommunitySettings,
  CommunitySettingsInputSchema,
  CommunitySettingsSchema,
  type CommunityViewer,
  DEFAULT_BRAND_ACCENT,
  DEFAULT_SETTINGS,
  type Profile,
} from "@ai/contracts/community";
import { type Context, Hono } from "hono";
import { appError } from "../../../../lib/errors";
import { parseWith, readJson } from "../../../../lib/http";
import type { PackGuardVars } from "../../kit/public";
import { toCommunityBrand, viewerCaps } from "../domain/brand.rules";
import { type Access, accessOf } from "./community-access";
import type { CommunityDeps } from "./community-deps";
import * as orgs from "./org.service";
import { profileTarget, withReputation } from "./profile.routes";
import { partnerViews } from "./views";

type R = Hono<PackGuardVars>;
type Acc = (c: Context<PackGuardVars>, need?: "read" | "write") => Promise<Access>;

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

/** `GET /viewer`: người xem + vai + công ty + quyền gói; `email` chỉ của chính người xem. */
async function viewerOf(d: CommunityDeps, a: Access): Promise<CommunityViewer> {
  const isPartner = a.org !== null;
  const [me, hasContracts, self] = await Promise.all([
    orgs.own(d.uow, a),
    !isPartner && d.caps ? d.caps.contracts(a.who) : false,
    d.contact ? d.contact(a.who) : null,
  ]);
  return {
    ...viewerCaps(isPartner, hasContracts, d.shtUrl),
    userId: a.who.userId,
    name: a.dir.userName,
    email: self?.email ?? null,
    role: a.org !== null ? "partner" : "host_member", // ADR-0044: không còn admin chủ quản
    orgId: a.org ?? a.who.tenantId,
    orgName:
      a.org === null ? a.dir.tenantName : (a.dir.orgs.find((o) => o.id === a.org)?.name ?? ""),
    labels: me?.labels ?? [],
    cats: me?.cats ?? [],
  };
}

function viewerAndPartners(r: R, d: CommunityDeps, access: Acc): void {
  r.get("/viewer", async (c) => c.json(await viewerOf(d, await access(c))));
  // CR-110 · COM-FR-45: brand công ty CHỦ QUẢN của tenant trong token (mọi account, kể cả đối tác), đúng 4 trường.
  r.get("/brand", async (c) => {
    const a = await access(c);
    const row = d.brand ? await d.brand.brand(a.who.tenantId) : null;
    // CR-110 low: logo data URL tới ~1.5 MB ⇒ ETag mạnh (sha-256 thân JSON) + private cache 5 phút; If-None-Match khớp ⇒ 304.
    const body = JSON.stringify(
      toCommunityBrand(row, a.dir.tenantName, COMMUNITY_BRAND_ACCENTS, DEFAULT_BRAND_ACCENT),
    );
    const etag = `"${new Bun.CryptoHasher("sha256").update(body).digest("hex")}"`;
    const cache = { ETag: etag, "Cache-Control": "private, max-age=300" };
    const inm = c.req.header("if-none-match");
    if (inm && inm.split(",").some((t) => t.trim() === etag || t.trim() === `W/${etag}`)) {
      return c.body(null, 304, cache);
    }
    return c.body(body, 200, { ...cache, "Content-Type": "application/json" });
  });
  r.get("/partners", async (c) => {
    const a = await access(c);
    const list = partnerViews(a, await orgs.partners(d.uow, a));
    // CR-110 · COM-FR-37: tab Đối tác của hồ sơ — cột uy tín chỉ chủ quản (cổng HostBookReader), `?rep=1` để feed không trả phí
    return c.json(c.req.query("rep") === "1" ? await withReputation(d, a, list) : list);
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
          notify: { ...DEFAULT_SETTINGS.notify, ...row.notify },
        })
      : null;
    return c.json(s?.success ? s.data : DEFAULT_SETTINGS);
  });
  r.put("/settings", async (c) => {
    const a = await access(c);
    // D8: `accent` cũ do client cũ gửi được nhận nhưng bỏ qua (màu chủ đạo là của công ty).
    const { notify } = parseWith(CommunitySettingsInputSchema, await readJson(c));
    const s: CommunitySettings = { notify };
    await orgs.putSettings(d.uow, a, s);
    return c.json(s);
  });
  // CR-130 · chuông: dùng chuông chung của shell (`GET/POST /notifications` hub); không còn route chuông riêng của Bảng tin.
}

export function orgRoutes(d: CommunityDeps): R {
  const r = new Hono<PackGuardVars>();
  const access: Acc = (c, need = "read") => accessOf(d.view, d.resolver, c, need);
  viewerAndPartners(r, d, access);
  settingsAndNotifications(r, d, access);
  return r;
}
