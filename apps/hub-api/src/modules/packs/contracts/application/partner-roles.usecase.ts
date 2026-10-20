// V2-C · KN-08 · HD-10 · BA 5.6 · DT-05: vai đối tác (nhãn MỚI), gợi ý đối tác khi gõ tên trên HĐ ("có sẵn + điểm" hoặc "Đối tác mới ·
// sẽ tạo khi lưu"), ghi chú đối tác. Mọi đọc/ghi trong tx người dùng (RLS M1); đối tác ngoài phạm vi ⇒ như chưa có (không lộ).
// Tạo đối tác/vai khi lưu HĐ là trigger DB (0024), không ở đây.
import type {
  PartnerDeal,
  PartnerLookup,
  PartnerNote,
  PartnerRoleRow,
  ScoreBand,
} from "@ai/contracts";
import type { PackUow, PackWho } from "../../kit/application/ports";
import type { PartnerRolesRepo, RoleCount } from "../adapters/partner-roles.repo";
import {
  DEFAULT_MIN_EVENTS,
  isNewRole,
  lookupKey,
  lookupResult,
} from "../domain/partner-roles.rules";

export class PartnerRolesFail extends Error {
  constructor(readonly kind: "not_found" | "forbidden" | "invalid") {
    super(kind);
  }
}

type Repos = { roles: PartnerRolesRepo };
/** Điểm uy tín hiện hành của (đối tác, vai) — engine HD8 cho khách/NCC; vai khác / chưa có ⇒ null (V2-E thay engine). */
export type ScoreOf = (
  who: PackWho,
  party: string,
  role: PartnerRoleRow["role"],
) => Promise<{ score: number | null; band: ScoreBand | null } | null>;
export type PartnerRolesDeps = { uow: PackUow<Repos>; scoreOf: ScoreOf };

const rowOf = (r: RoleCount): PartnerRoleRow => {
  const min = r.min_events ?? DEFAULT_MIN_EVENTS;
  return { ...r, min_events: min, is_new: isNewRole(r.events, min) };
};

export function partnerRolesUsecase(d: PartnerRolesDeps) {
  const roles = async (who: PackWho, party?: string): Promise<PartnerRoleRow[]> =>
    (await d.uow.tenant(who, (x) => x.roles.roles(party ?? null))).map(rowOf);

  const lookup = async (
    who: PackWho,
    q: { name: string; tax_id?: string | undefined; deal?: PartnerDeal | undefined },
  ): Promise<PartnerLookup> => {
    const key = lookupKey(q.name, q.tax_id);
    if (!key) throw new PartnerRolesFail("invalid");
    const fold = key.startsWith("name:") ? key.slice(5) : null;
    const found = await d.uow.tenant(who, async (x) => {
      const hit = await x.roles.find(key, fold);
      return hit ? { hit, roles: (await x.roles.roles(hit.party)).map(rowOf) } : null;
    });
    if (!found) return lookupResult(key, null, q.deal, null);
    const res = lookupResult(key, { ...found.hit, roles: found.roles }, q.deal, null);
    if (res.status !== "existing" || !res.role || !res.has_role) return res;
    const s = await d.scoreOf(who, res.party, res.role);
    return { ...res, score: s?.score ?? null, band: s?.band ?? null };
  };

  const notes = (who: PackWho, party: string): Promise<PartnerNote[]> =>
    d.uow.tenant(who, (x) => x.roles.notes(party));

  const addNote = async (who: PackWho, party: string, body: string): Promise<PartnerNote> => {
    const n = await d.uow.tenant(who, (x) => x.roles.addNote(party, body));
    if (!n) throw new PartnerRolesFail("not_found");
    return n;
  };

  /** Người viết xoá ghi chú của mình; quản lý (`admin`) xoá mọi ghi chú mình thấy. */
  const deleteNote = async (who: PackWho, id: string, admin: boolean) => {
    const r = await d.uow.tenant(who, (x) => x.roles.deleteNote(id, admin));
    if (r.deleted > 0) return { deleted: true };
    throw new PartnerRolesFail(r.exists ? "forbidden" : "not_found");
  };

  return { roles, lookup, notes, addNote, deleteNote };
}
export type PartnerRolesUsecase = ReturnType<typeof partnerRolesUsecase>;
