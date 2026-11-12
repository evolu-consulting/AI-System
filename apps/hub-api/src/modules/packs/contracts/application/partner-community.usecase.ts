// CR-130 pha 2 · L3 · ADR-0043: hồ sơ Bảng tin của đối tác SHT — đọc, sửa nhóm hàng/khu vực, mời (gắn tài khoản công ty ngoài) / gỡ,
// danh sách tài khoản chọn được. Ghi chỉ quản trị gói (route kiểm `admin`; RLS 0103 chốt thứ hai). `ext_org_id` phải là tài khoản còn
// hiệu lực của tenant (cổng kit `ExternalOrgResolver`, không FK qua gói).
import {
  PARTNER_COMMUNITY_CANDIDATES_MAX,
  type PartnerCommunity,
  type PartnerCommunityCandidate,
} from "@ai/contracts/pack-contracts";
import type { ExternalOrgResolver, PackUow, PackWho } from "../../kit/public";
import type { PartnerProfileRepo, ProfileRaw } from "./partner-community.ports";

export class PartnerCommunityFail extends Error {
  constructor(readonly kind: "not_found" | "invalid_account" | "account_taken") {
    super(kind);
  }
}

export type PartnerCommunityDeps = {
  uow: PackUow<{ profile: PartnerProfileRepo }>;
  ext: ExternalOrgResolver;
};

const isUnique = (e: unknown): boolean => {
  const x = e as { code?: string; cause?: { code?: string } } | null;
  return x?.code === "23505" || x?.cause?.code === "23505";
};

async function view(
  d: PartnerCommunityDeps,
  who: PackWho,
  r: ProfileRaw,
): Promise<PartnerCommunity> {
  const names = r.ext_org_id ? await d.ext.orgNames(who.tenantId, [r.ext_org_id]) : null;
  const o = r.ext_org_id ? names?.get(r.ext_org_id) : undefined;
  return {
    party: r.party,
    name: r.name,
    roles: r.roles,
    cats: r.cats,
    area: r.area,
    account: r.ext_org_id
      ? { id: r.ext_org_id, name: o?.name ?? "", active: o?.active ?? false }
      : null,
    invited_at: r.invited_at,
  };
}

export function partnerCommunityUsecase(d: PartnerCommunityDeps) {
  const get = async (who: PackWho, party: string): Promise<PartnerCommunity> => {
    const r = await d.uow.tenant(who, (x) => x.profile.get(party));
    if (!r) throw new PartnerCommunityFail("not_found");
    return view(d, who, r);
  };
  return {
    get,
    saveProfile: async (who: PackWho, party: string, cats: string[], area: string) => {
      const ok = await d.uow.tenant(who, (x) =>
        x.profile.saveProfile(party, [...new Set(cats)], area),
      );
      if (!ok) throw new PartnerCommunityFail("not_found");
      return get(who, party);
    },
    /** Mời (`orgId`) hoặc gỡ (`null`). Tài khoản lạ/tenant khác/đã ngừng ⇒ `invalid_account`; đã gắn đối tác khác ⇒ `account_taken`. */
    setAccount: async (who: PackWho, party: string, orgId: string | null) => {
      if (orgId) {
        const o = (await d.ext.orgNames(who.tenantId, [orgId])).get(orgId);
        if (!o?.active) throw new PartnerCommunityFail("invalid_account");
      }
      const ok = await d.uow
        .tenant(who, (x) => x.profile.setAccount(party, orgId))
        .catch((e: unknown) => {
          throw isUnique(e) ? new PartnerCommunityFail("account_taken") : e;
        });
      if (!ok) throw new PartnerCommunityFail("not_found");
      return get(who, party);
    },
    /** Tài khoản công ty ngoài còn hiệu lực chưa gắn đối tác nào — 2 câu cố định (danh bạ + đã gắn), lọc trong bộ nhớ. */
    candidates: async (who: PackWho): Promise<PartnerCommunityCandidate[]> => {
      const [dir, linked] = await Promise.all([
        d.ext.directory(who.tenantId, who.userId),
        d.uow.tenant(who, (x) => x.profile.linkedOrgs()),
      ]);
      const taken = new Set(linked);
      return dir.orgs
        .filter((o) => o.active && !taken.has(o.id))
        .slice(0, PARTNER_COMMUNITY_CANDIDATES_MAX)
        .map((o) => ({ id: o.id, name: o.name }));
    },
  };
}
export type PartnerCommunityUsecase = ReturnType<typeof partnerCommunityUsecase>;
