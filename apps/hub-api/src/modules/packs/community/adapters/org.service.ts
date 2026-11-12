// CR-102 · com-c3 · service công ty đối tác / nhóm hàng / hồ sơ / cài đặt (T-DEP-1). Mỗi hàm MỘT tx gói (RLS người xem).
import type { Tx } from "@ai/db";
import type { PackUow } from "../../kit/public";
import type { Access } from "./community-access";
import { type MediaCursor, type MediaRow, profileMedia } from "./media.sql";
import {
  catList,
  type PartnerRow,
  partnerRows,
  profileStats,
  type SettingsRow,
  saveSettings,
  settingsOf,
} from "./org.repo";

type Uow = PackUow<{ tx: Tx }>;

/** Công ty người xem được thấy hồ sơ: chủ quản = mọi công ty đối tác trong danh bạ; đối tác = chỉ công ty mình (hàm cổng cũng ép lại). */
const orgIds = (a: Access): string[] => (a.org === null ? a.dir.orgs.map((o) => o.id) : [a.org]);

export const partners = (uow: Uow, a: Access): Promise<PartnerRow[]> =>
  uow.tenant(a.who, ({ tx }) => partnerRows(tx, orgIds(a)));

/** Hàng vai/nhóm hàng của công ty người xem (đối tác); chủ quản ⇒ undefined. */
export async function own(uow: Uow, a: Access): Promise<PartnerRow | undefined> {
  if (a.org === null) return undefined;
  const org = a.org;
  return (await uow.tenant(a.who, ({ tx }) => partnerRows(tx, [org])))[0];
}

export const cats = (uow: Uow, a: Access): Promise<string[]> =>
  uow.tenant(a.who, ({ tx }) => catList(tx, orgIds(a)));

/** Thống kê bài của một bên (`null` = chủ quản) + hàng công ty đối tác (khi cần). */
export const profile = (uow: Uow, a: Access, target: string | null) =>
  uow.tenant(a.who, async ({ tx }) => ({
    stats: await profileStats(tx, target),
    rows: target === null ? [] : await partnerRows(tx, [target]),
  }));

/** CR-110 · COM-FR-37: đính kèm bài của `target` (`null` = chủ quản) dưới RLS người xem — MỘT câu mỗi trang. */
export const media = (
  uow: Uow,
  a: Access,
  target: string | null,
  cursor: MediaCursor | null,
  limit: number,
): Promise<MediaRow[]> =>
  uow.tenant(a.who, ({ tx }) => profileMedia(tx, a.who.tenantId, target, cursor, limit));

export const settings = (uow: Uow, a: Access): Promise<SettingsRow | null> =>
  uow.tenant(a.who, ({ tx }) => settingsOf(tx, a.who.userId));

export const putSettings = (uow: Uow, a: Access, s: SettingsRow): Promise<void> =>
  uow.tenant(a.who, ({ tx }) => saveSettings(tx, a.who.tenantId, a.who.userId, s));
