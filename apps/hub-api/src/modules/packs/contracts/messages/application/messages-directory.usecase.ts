// CR-190 · use case danh bạ nhóm trang Tin nhắn `GET /messages/directory` (lớp 2, không SQL). Nhóm theo thứ tự cố định: từng công ty đối tác (A→Z, hub 0167), «Nhóm chat», «Nội bộ».
// KHÔNG mở rộng ai được nhắn ai: nội bộ = đồng nghiệp còn dùng được (đúng luật tạo 1-1), đối tác = `pmsg_eligible_v` của công ty đang kết nối (cùng nguồn `pmsg_people`/`pmsg_open`); cộng đầu kia
// của cuộc ĐÃ CÓ. Số câu SQL cố định theo loại yêu cầu (không theo số nhóm/dòng): tx 1 (cuộc nhẹ, id ghim/cờ, đầu nhóm, dòng nhóm đối tác, ghim) → tra người (1) → tx 2 (tin cuối của dòng trang).
import type {
  ConversationSummary,
  MsgCompany,
  MsgDirectoryQuery,
  MsgDirectoryResponse,
  MsgDirGroup,
  MsgDirRow,
} from "@ai/contracts/pack-contracts";
import type { PackUow, PackWho } from "../../../kit/public";
import {
  chatItems,
  type DirItem,
  type DirKey,
  decodeDirCursor,
  encodeDirCursor,
  internalItems,
  pageAfter,
  unreadSum,
} from "../domain/messages.directory";
import { internalOnPartnerDenied } from "./messages.ops";
import type {
  MessagesRepos,
  PartnerDirHead,
  PartnerDirRow,
  RawConversation,
} from "./messages.ports";
import { type People, summaryOf } from "./messages.view";
import { withPrefs } from "./messages-prefs.usecase";

type DirPeopleResult = {
  company: MsgCompany;
  people: ReadonlyMap<string, { name: string; active: boolean; job_title: string | null }>;
};
/** Đồng nghiệp còn dùng được + các id xin thêm (cùng cờ `active`) + công ty của người gọi. */
export type DirectoryPeopleFn = (
  who: { tenantId: string; userId: string; userKind?: "internal" | "external" },
  extraIds: readonly string[],
) => Promise<DirPeopleResult>;

type Deps = { uow: PackUow<MessagesRepos>; dirPeople?: DirectoryPeopleFn | undefined };
type Scope = { chat: boolean; internal: boolean; partner: string | "all" | null };
type Loaded = {
  convs: Awaited<ReturnType<MessagesRepos["messages"]["directoryConvs"]>>;
  heads: PartnerDirHead[];
  rows: PartnerDirRow[];
  raws: Map<string, RawConversation>;
};

/** `group` → những nguồn cần đọc. Vắng ⇒ tất cả. */
function scopeOf(group: string | undefined): Scope {
  if (!group) return { chat: true, internal: true, partner: "all" };
  if (group === "chat") return { chat: true, internal: false, partner: null };
  if (group === "internal") return { chat: false, internal: true, partner: null };
  return { chat: false, internal: false, partner: group.slice("partner:".length).toLowerCase() };
}

/** Cuộc `partner` thô từ một dòng hàm hub (ghim/cờ gắn sau bằng `withPrefs`). */
function partnerRaw(r: PartnerDirRow): RawConversation {
  return {
    id: r.thread_id as string,
    kind: "partner",
    title: null,
    last_at: r.last_at as string,
    member_count: 2,
    peer_id: r.user_id,
    unread: r.unread,
    last: r.last,
    my_role: "member",
    members: null,
    partner: {
      peer_name: r.name,
      peer_title: r.job_title,
      peer_active: r.peer_active,
      company_id: r.company_id,
      company_name: r.company_name,
      read_only: r.read_only,
    },
  };
}

const dirKeyOf = (r: PartnerDirRow): DirKey => ({ k1: r.k1, k2: r.k2, k3: r.k3, id: r.user_id });

/** Nhóm công ty đối tác: đầu + dòng đã cắt đúng `limit` (DB trả `limit + 1` để biết còn trang sau). */
function partnerGroups(
  heads: readonly PartnerDirHead[],
  rows: readonly PartnerDirRow[],
  limit: number,
  rawOf: (r: PartnerDirRow) => RawConversation | null,
  people: People,
): MsgDirGroup[] {
  const by = new Map<string, PartnerDirRow[]>();
  for (const r of rows) by.set(r.company_id, [...(by.get(r.company_id) ?? []), r]);
  return heads.map((h) => {
    const all = by.get(h.company_id) ?? [];
    const page = all.slice(0, limit);
    const last = page[page.length - 1];
    const company = { id: h.company_id, name: h.name };
    return {
      key: `partner:${h.company_id}` as MsgDirGroup["key"],
      kind: "partner",
      company,
      total: h.total,
      unread: Math.min(h.unread, 999),
      items: page.map((r): MsgDirRow => {
        const raw = rawOf(r);
        return {
          key: `u:${r.user_id}`,
          conversation: raw ? summaryOf(raw, people) : null,
          person: {
            id: r.user_id,
            name: r.name,
            job_title: r.job_title,
            active: r.peer_active,
            company,
          },
        };
      }),
      next_cursor: all.length > limit && last ? encodeDirCursor(dirKeyOf(last)) : null,
    };
  });
}

type Repos = MessagesRepos;

/** Phần đối tác của tx 1: đầu nhóm + dòng (+ ghim) — MỘT lần gọi hàm hub mỗi việc. */
async function loadPartner(
  r: Repos,
  me: string,
  q: MsgDirectoryQuery,
  sc: Scope,
  cur: DirKey | null,
): Promise<Pick<Loaded, "heads" | "rows" | "raws">> {
  const raws = new Map<string, RawConversation>();
  if (sc.partner === null) return { heads: [], rows: [], raws };
  const search = q.q && q.q.length > 0 ? q.q : null;
  const prefs = await r.messages.partnerPrefs(me);
  const company = sc.partner === "all" ? null : sc.partner;
  const heads = await r.partner.dirHeads(company, search, prefs.flagged);
  if (heads.length === 0) return { heads, rows: [], raws };
  const rows = await r.partner.dirRows({
    company,
    q: search,
    pinned: prefs.pinned,
    flagged: prefs.flagged,
    cur,
    limit: q.limit + 1,
  });
  const withP = await withPrefs(r, me, rows.filter((x) => x.thread_id !== null).map(partnerRaw));
  for (const x of withP) raws.set(x.id, x);
  return { heads, rows, raws };
}

type Own = { items: DirItem[]; page: DirItem[]; next: DirKey | null };
/** Một nhóm tự dựng (`chat`/`internal`): tổng, chưa đọc, trang `limit` sau con trỏ. */
function ownGroup(
  key: "chat" | "internal",
  own: Own,
  rowOf: (i: DirItem) => MsgDirRow,
): MsgDirGroup {
  return {
    key,
    kind: key,
    company: null,
    total: own.items.length,
    unread: unreadSum(own.items),
    items: own.page.map(rowOf),
    next_cursor: own.next ? encodeDirCursor(own.next) : null,
  };
}

/** Dựng dòng nội bộ: cuộc (tin cuối + ghim/cờ của người gọi) + người (kèm công ty của người gọi). */
function rowBuilder(
  byId: ReadonlyMap<string, RawConversation>,
  people: People,
  dir: DirPeopleResult,
): (i: DirItem) => MsgDirRow {
  return (i) => {
    const raw = i.conv ? byId.get(i.conv.id) : undefined;
    const conversation: ConversationSummary | null =
      i.conv && raw
        ? summaryOf(
            { ...raw, pinned_at: i.conv.pinned_at, marked_unread: i.conv.marked_unread },
            people,
          )
        : null;
    const p = i.personId ? dir.people.get(i.personId) : undefined;
    const person =
      i.personId && p
        ? {
            id: i.personId,
            name: p.name,
            job_title: p.job_title,
            active: p.active,
            company: dir.company,
          }
        : null;
    return { key: i.rowKey, conversation, person };
  };
}

/** Id cần tra tên: đầu kia/người gửi tin cuối của cuộc đã có + chính người gọi. */
const extraIdsOf = (me: string, convs: Loaded["convs"]): string[] => {
  const ids = new Set<string>([me]);
  for (const c of convs) {
    if (c.peer_id) ids.add(c.peer_id);
    if (c.last_sender) ids.add(c.last_sender);
  }
  return [...ids];
};

/** Hai nhóm tự dựng + trang hiện tại; chỉ nhóm được hỏi mới áp con trỏ. */
function ownPages(
  me: string,
  sc: Scope,
  convs: Loaded["convs"],
  dir: DirPeopleResult,
  q: MsgDirectoryQuery,
  cur: DirKey | null,
): { chat: Own; internal: Own } {
  const pool = new Map(dir.people);
  pool.delete(me); // không tự nhắn mình
  const mk = (items: DirItem[], c: DirKey | null): Own => ({
    items,
    ...pageAfter(items, c, q.limit),
  });
  const search = q.q ?? "";
  return {
    chat: mk(sc.chat ? chatItems(convs, search) : [], sc.chat && !sc.internal ? cur : null),
    internal: mk(
      sc.internal ? internalItems(convs, pool, search) : [],
      sc.internal && !sc.chat ? cur : null,
    ),
  };
}

/** Có tìm kiếm ⇒ ẩn nhóm không còn dòng khớp (nhóm đối tác đã lọc ở DB); nhóm được hỏi đích danh luôn trả. */
const showOwn = (sc: Scope, key: "chat" | "internal", g: Own, q: MsgDirectoryQuery): boolean =>
  sc[key] && (g.items.length > 0 || (!q.q && !q.group) || q.group === key);

export function directoryOps(d: Deps) {
  /** Tx 1: mọi thứ cần để xếp nhóm (người gọi chưa đủ quyền đối tác ⇒ bỏ phần đối tác, chạy lại tx mới). */
  const load = (
    who: PackWho,
    q: MsgDirectoryQuery,
    sc: Scope,
    cur: DirKey | null,
    withPartner: boolean,
  ) =>
    d.uow.tenant(who, async (r): Promise<Loaded> => {
      const convs = sc.chat || sc.internal ? await r.messages.directoryConvs(who.userId) : [];
      const partner = withPartner
        ? await loadPartner(r, who.userId, q, sc, cur)
        : { heads: [], rows: [], raws: new Map<string, RawConversation>() };
      return { convs, ...partner };
    });

  /** Tx 2: tin cuối của các dòng nội bộ của trang, MỘT câu `= any`. */
  const lastOf = async (who: PackWho, items: readonly DirItem[]) => {
    const ids = items.flatMap((i) => (i.conv ? [i.conv.id] : []));
    const byId = new Map<string, RawConversation>();
    if (ids.length === 0) return byId;
    for (const x of await d.uow.tenant(who, (r) => r.messages.conversationsByIds(who.userId, ids)))
      byId.set(x.id, x);
    return byId;
  };

  /** Tx 1 (+ chạy lại không phần đối tác nếu người gọi chưa đủ quyền Sổ Hợp Tác). */
  const loadAll = (who: PackWho, q: MsgDirectoryQuery, sc: Scope, cur: DirKey | null) => {
    const run = (withPartner: boolean) => load(who, q, sc, cur, withPartner);
    const mixed = sc.partner !== null && (sc.chat || sc.internal);
    return mixed
      ? internalOnPartnerDenied(
          () => run(true),
          () => run(false),
        )
      : run(true);
  };

  /** Tra người MỘT lần: đồng nghiệp + đầu kia/người gửi tin cuối của cuộc đã có + chính người gọi. */
  const peopleOf = (who: PackWho, convs: Loaded["convs"]): Promise<DirPeopleResult> =>
    d.dirPeople
      ? d.dirPeople(who, extraIdsOf(who.userId, convs))
      : Promise.resolve({ company: { id: who.tenantId, name: "" }, people: new Map() });

  return {
    /** `GET /messages/directory` */
    async directory(who: PackWho, q: MsgDirectoryQuery): Promise<MsgDirectoryResponse> {
      const cur = q.cursor ? decodeDirCursor(q.cursor) : null;
      if (q.cursor && (!cur || !q.group)) throw new Error("BAD_CURSOR");
      const sc = scopeOf(q.group);
      const got = await loadAll(who, q, sc, cur);
      const dir = await peopleOf(who, got.convs);
      const own = ownPages(who.userId, sc, got.convs, dir, q, cur);
      const byId = await lastOf(who, [...own.chat.page, ...own.internal.page]);
      const rowOf = rowBuilder(byId, dir.people, dir);
      const groups: MsgDirGroup[] = partnerGroups(
        got.heads,
        got.rows,
        q.limit,
        (r) => (r.thread_id ? (got.raws.get(r.thread_id) ?? null) : null),
        dir.people,
      );
      for (const key of ["chat", "internal"] as const)
        if (showOwn(sc, key, own[key], q)) groups.push(ownGroup(key, own[key], rowOf));
      return { groups };
    },
  };
}
