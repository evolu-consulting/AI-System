// CR-102 · com-c3 · service công ty đối tác / nhóm hàng / hồ sơ / cài đặt (T-DEP-1). Mỗi hàm MỘT tx gói (RLS người xem).
import type { PartnerUpdateInput } from "@ai/contracts/community";
import type { Tx } from "@ai/db";
import type { PackUow } from "../../kit/application/ports";
import type { Access } from "./community-access";
import {
  catList,
  type PartnerRow,
  partnerRows,
  profileStats,
  type SettingsRow,
  saveSettings,
  settingsOf,
  upsertPartner,
} from "./org.repo";

type Uow = PackUow<{ tx: Tx }>;

export const partners = (uow: Uow, a: Access): Promise<PartnerRow[]> =>
  uow.tenant(a.who, ({ tx }) => partnerRows(tx));

/** Hàng nhãn/nhóm hàng của công ty người xem (đối tác); chủ quản ⇒ undefined. */
export async function own(uow: Uow, a: Access): Promise<PartnerRow | undefined> {
  if (a.org === null) return undefined;
  return (await partners(uow, a)).find((p) => p.ext_org_id === a.org);
}

export const savePartner = (
  uow: Uow,
  a: Access,
  org: string,
  p: Required<Omit<PartnerUpdateInput, "partyKey">> & { partyKey: string | null },
): Promise<PartnerRow[]> =>
  uow.tenant(a.who, async ({ tx }) => {
    await upsertPartner(tx, a.who, org, p);
    return partnerRows(tx);
  });

export const cats = (uow: Uow, a: Access): Promise<string[]> =>
  uow.tenant(a.who, ({ tx }) => catList(tx));

/** Thống kê bài của một bên (`null` = chủ quản) + hàng công ty đối tác (khi cần). */
export const profile = (uow: Uow, a: Access, target: string | null) =>
  uow.tenant(a.who, async ({ tx }) => ({
    stats: await profileStats(tx, target),
    rows: target === null ? [] : await partnerRows(tx),
  }));

export const settings = (uow: Uow, a: Access): Promise<SettingsRow | null> =>
  uow.tenant(a.who, ({ tx }) => settingsOf(tx, a.who.userId));

export const putSettings = (uow: Uow, a: Access, s: SettingsRow): Promise<void> =>
  uow.tenant(a.who, ({ tx }) => saveSettings(tx, a.who.tenantId, a.who.userId, s));
