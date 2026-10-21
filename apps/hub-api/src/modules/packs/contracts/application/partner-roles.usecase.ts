// V2-C · KN-08 · HD-10 · BA 5.6 · DT-05: vai đối tác (nhãn MỚI), gợi ý đối tác khi gõ tên trên HĐ ("có sẵn + điểm" hoặc "Đối tác mới ·
// sẽ tạo khi lưu"), ghi chú đối tác. Mọi đọc/ghi trong tx người dùng (RLS M1); đối tác ngoài phạm vi ⇒ như chưa có (không lộ).
// Tạo đối tác/vai khi lưu HĐ là trigger DB (0024), không ở đây.

import type { PackUow, PackWho } from "../../kit/application/ports";
import { localDate } from "../domain/local-time.rules";
import {
  DEFAULT_MIN_EVENTS,
  isNewRole,
  lookupKey,
  lookupResult,
} from "../domain/partner-roles.rules";
import type {
  PartnerContactIn,
  PartnerContactsPut,
  PartnerContractCount,
  PartnerContractRow,
  PartnerDeal,
  PartnerLookup,
  PartnerNote,
  PartnerProfile,
  PartnerRoleRow,
  PartnerWebLine,
  ScoreBand,
} from "../domain/partner-roles.types";
import type { PartnerRolesRepo, RoleCount } from "./partner-roles.ports";
import { toProgress } from "./progress";

export class PartnerRolesFail extends Error {
  constructor(
    readonly kind:
      | "not_found"
      | "forbidden"
      | "invalid"
      | "ai_unavailable"
      | "ai_cap"
      | "ai_failed",
  ) {
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
/** V2-I · DT-07 · Q8: tìm web CHỈ với tên + MST (adapter AI); `null` ⇒ chưa cấu hình AI ⇒ `ai_unavailable`. */
export type WebSearch = (
  who: PackWho,
  q: { name: string; taxId: string | null },
  signal: AbortSignal,
) => Promise<
  { ok: true; lines: PartnerWebLine[] } | { ok: false; code: "cap" | "unavailable" | "failed" }
>;
export type PartnerRolesDeps = {
  uow: PackUow<Repos>;
  scoreOf: ScoreOf;
  timeZoneOf?: (tenantId: string) => Promise<string>;
  now?: () => Date;
  webSearch?: WebSearch | null;
};

const rowOf = (r: RoleCount): PartnerRoleRow => {
  const min = r.min_events ?? DEFAULT_MIN_EVENTS;
  return { ...r, min_events: min, is_new: isNewRole(r.events, min) };
};

type LookupQuery = { name: string; tax_id?: string | undefined; deal?: PartnerDeal | undefined };

async function lookupPartner(
  d: PartnerRolesDeps,
  who: PackWho,
  q: LookupQuery,
): Promise<PartnerLookup> {
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
}

/** Ngày lịch tenant (vắng múi giờ ⇒ ngày UTC). */
function todayOf(d: PartnerRolesDeps, who: PackWho): Promise<string> {
  const now = d.now ?? (() => new Date());
  return d.timeZoneOf
    ? d.timeZoneOf(who.tenantId).then((tz) => localDate(now(), tz))
    : Promise.resolve(now().toISOString().slice(0, 10));
}

/** DT-06: HĐ của đối tác + giai đoạn (ngày lịch tenant). */
async function partnerContracts(
  d: PartnerRolesDeps,
  who: PackWho,
  party: string,
): Promise<PartnerContractRow[]> {
  const [raw, today] = await Promise.all([
    d.uow.tenant(who, (x) => x.roles.contracts(party)),
    todayOf(d, who),
  ]);
  return raw.map((r) => {
    const p = toProgress(r, today);
    return {
      id: r.id,
      title: r.title,
      number: r.number,
      deal: r.deal,
      value: r.value === null ? null : Number(r.value),
      start_date: r.start_date,
      end_date: r.end_date,
      stage: p.stage,
      next: p.next && { title: p.next.title, due_date: p.next.due_date, overdue: p.next.overdue },
    };
  });
}

/** DT-01: MST / liên hệ đầu trang; đối tác ngoài phạm vi ⇒ 404. */
async function partnerProfile(
  d: PartnerRolesDeps,
  who: PackWho,
  party: string,
): Promise<PartnerProfile> {
  const p = await d.uow.tenant(who, (x) => x.roles.profile(party));
  if (!p) throw new PartnerRolesFail("not_found");
  return p;
}

/** V2-GAPS · DT-01: sửa điện thoại / liên hệ; trả hồ sơ mới. Đối tác ngoài phạm vi ⇒ 404. */
async function saveContact(d: PartnerRolesDeps, who: PackWho, b: PartnerContactIn) {
  const r = await d.uow.tenant(who, (x) => x.roles.setContact(b.party, b.phone, b.contact));
  if (!r) throw new PartnerRolesFail("not_found");
  return partnerProfile(d, who, b.party);
}

/** GAP-D2 · #24: người liên hệ; đối tác ngoài phạm vi ⇒ 404 (đọc dùng hồ sơ làm cổng phạm vi). */
async function contactsOf(d: PartnerRolesDeps, who: PackWho, party: string) {
  await partnerProfile(d, who, party);
  return d.uow.tenant(who, (x) => x.roles.contacts(party));
}
async function saveContacts(d: PartnerRolesDeps, who: PackWho, b: PartnerContactsPut) {
  const r = await d.uow.tenant(who, (x) => x.roles.setContacts(b.party, b.contacts));
  if (!r) throw new PartnerRolesFail("not_found");
  return r;
}

/** DT-07 · Q8: chạy khi bấm; đối tác phải nằm trong phạm vi người dùng; chỉ tên + MST ra ngoài. */
async function internetSearch(
  d: PartnerRolesDeps,
  who: PackWho,
  party: string,
  signal: AbortSignal,
) {
  const p = await partnerProfile(d, who, party);
  const name = p.name?.trim() || party.replace(/^(tax|name):/, "");
  if (!d.webSearch) throw new PartnerRolesFail("ai_unavailable");
  const r = await d.webSearch(who, { name, taxId: p.tax_id }, signal);
  if (r.ok) return { lines: r.lines };
  throw new PartnerRolesFail(
    r.code === "cap" ? "ai_cap" : r.code === "unavailable" ? "ai_unavailable" : "ai_failed",
  );
}

function noteCommands(d: PartnerRolesDeps) {
  const notes = (who: PackWho, party: string): Promise<PartnerNote[]> =>
    d.uow.tenant(who, (x) => x.roles.notes(party));

  const addNote = async (
    who: PackWho,
    party: string,
    body: string,
    source: "manual" | "internet" = "manual",
  ): Promise<PartnerNote> => {
    const n = await d.uow.tenant(who, (x) => x.roles.addNote(party, body, source));
    if (!n) throw new PartnerRolesFail("not_found");
    return n;
  };

  /** Người viết xoá ghi chú của mình; quản lý (`admin`) xoá mọi ghi chú mình thấy. */
  const deleteNote = async (who: PackWho, id: string, admin: boolean) => {
    const r = await d.uow.tenant(who, (x) => x.roles.deleteNote(id, admin));
    if (r.deleted > 0) return { deleted: true };
    throw new PartnerRolesFail(r.exists ? "forbidden" : "not_found");
  };
  return { notes, addNote, deleteNote };
}

export function partnerRolesUsecase(d: PartnerRolesDeps) {
  return {
    roles: async (who: PackWho, party?: string): Promise<PartnerRoleRow[]> =>
      (await d.uow.tenant(who, (x) => x.roles.roles(party ?? null))).map(rowOf),
    lookup: (who: PackWho, q: LookupQuery): Promise<PartnerLookup> => lookupPartner(d, who, q),
    ...noteCommands(d),
    profile: (who: PackWho, party: string): Promise<PartnerProfile> =>
      partnerProfile(d, who, party),
    saveContact: (who: PackWho, b: PartnerContactIn) => saveContact(d, who, b),
    contacts: (who: PackWho, party: string) => contactsOf(d, who, party),
    saveContacts: (who: PackWho, b: PartnerContactsPut) => saveContacts(d, who, b),
    contracts: (who: PackWho, party: string): Promise<PartnerContractRow[]> =>
      partnerContracts(d, who, party),
    contractCounts: (who: PackWho): Promise<PartnerContractCount[]> =>
      d.uow.tenant(who, (x) => x.roles.contractCounts()),
    internetSearch: (who: PackWho, party: string, signal: AbortSignal) =>
      internetSearch(d, who, party, signal),
  };
}
export type PartnerRolesUsecase = ReturnType<typeof partnerRolesUsecase>;
