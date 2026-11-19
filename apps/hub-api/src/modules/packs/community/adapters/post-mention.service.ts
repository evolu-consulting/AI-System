// CR-145 · nhắc NGƯỜI trong bài đăng. Luật "ai nhắc được ai" = luật XEM BÀI có sẵn: chủ quản nhắc được chủ quản (có quyền đọc gói,
// `packHosts`) + người của công ty đối tác thấy bài (`orgsSeeingPost`/`audience_ok`); đối tác chỉ nhắc đồng nghiệp công ty mình (không lộ
// tên người chủ quản/đối tác khác). Kiểm theo tập: danh bạ MỘT câu + `orgsSeeingPost` MỘT câu. Sai ⇒ 422 `MENTION_USER_NOT_ALLOWED`.
import type { MentionablePeopleQuery, MentionablePerson } from "@ai/contracts/community";
import type { Tx } from "@ai/db";
import { AppError, appError } from "../../../../lib/errors";
import type { PackUow, PeopleReader, Person } from "../../kit/public";
import { type Audience, defaultAudience, type PostType } from "../domain/audience.rules";
import { orgsSeeingPost } from "./comment-list.repo";
import type { Access } from "./community-access";
import { crossPostTenant } from "./cross-comment.repo";
import {
  connectedAudience,
  connectedSeeingDraft,
  connectedSeeingPost,
  type DraftScope,
  mentionTenantsOk,
  orgsInGroup,
  orgsSeeingDraft,
  replaceMentions,
} from "./post-mention.repo";
import { postState } from "./post-write.repo";

export type MentionDeps = {
  hosts: (tenantId: string) => Promise<readonly string[]>;
  orgMembers: (
    tenantId: string,
    orgIds: readonly string[],
  ) => Promise<ReadonlyMap<string, readonly string[]>>;
  people: PeopleReader;
};

const notAllowed = () =>
  new AppError("MENTION_USER_NOT_ALLOWED", 422, "Không nhắc được người này trên bài này");

const activeOrgIds = (a: Access): Set<string> =>
  new Set(a.dir.orgs.filter((o) => o.active).map((o) => o.id));

/** CR-191: người của công ty KHÁC (đã kết nối) — khác tenant người đăng. */
export const isForeign = (p: Person, tenantId: string): boolean =>
  p.tenant !== undefined && p.tenant !== tenantId;

/**
 * Bước 1 (ngoài tx): id → người (còn dùng được) + kiểm bên. Người lạ/đã khoá/ngoài phạm vi bên ⇒ 422. Trả danh sách đã khử trùng.
 * CR-191: id không thuộc tenant mình ⇒ thử «người công ty khác» (chỉ chủ quản, `allowForeign`); đã kết nối + trong «Ai thấy bài» kiểm
 * tiếp ở `assertSeen` (DEFINER, trong tx ghi bài). Bình luận chưa nhắc chéo công ty được (lát cr191-cross-comment) ⇒ `allowForeign=false`.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: một luồng kiểm bên + người công ty khác, đọc từ trên xuống
export async function resolvePeople(
  d: MentionDeps | undefined,
  a: Access,
  ids: readonly string[] | undefined,
  allowForeign = true,
): Promise<Person[]> {
  const uniq = [...new Set((ids ?? []).map((i) => i.toLowerCase()))];
  if (uniq.length === 0) return [];
  if (!d) throw notAllowed();
  let people = await d.people(a.who.tenantId, uniq);
  if (people.length !== uniq.length) {
    if (a.org !== null || !allowForeign) throw notAllowed();
    const got = new Set(people.map((p) => p.id));
    const rest = uniq.filter((i) => !got.has(i));
    const far = await d.people(a.who.tenantId, [], { foreignIds: rest });
    if (far.length !== rest.length) throw notAllowed();
    people = [...people, ...far];
  }
  if (a.org !== null) {
    // đối tác: chỉ người công ty mình
    if (!people.every((p) => p.org === a.org)) throw notAllowed();
    return people;
  }
  const act = activeOrgIds(a);
  const near = people.filter((p) => !isForeign(p, a.who.tenantId));
  if (near.some((p) => p.org !== null && !act.has(p.org))) throw notAllowed();
  if (near.some((p) => p.org === null)) {
    const hosts = new Set(await d.hosts(a.who.tenantId));
    if (!near.every((p) => p.org !== null || hosts.has(p.id))) throw notAllowed();
  }
  return people;
}

/** Bước 2 (trong tx, bài đã có): công ty của người được nhắc phải thấy bài (`orgsSeeingPost`, chỉ chủ quản cần). */
export async function assertSeen(tx: Tx, a: Access, postId: string, people: readonly Person[]) {
  if (a.org !== null) return;
  const near = people.filter((p) => !isForeign(p, a.who.tenantId));
  const orgs = [...new Set(near.flatMap((p) => (p.org ? [p.org] : [])))];
  const seeing = new Set(await orgsSeeingPost(tx, a.who.tenantId, postId, orgs));
  if (!orgs.every((o) => seeing.has(o))) throw notAllowed();
  // CR-191: công ty đã kết nối ∈ «Ai thấy bài» (DEFINER kiểm lại kết nối MỖI lần); ngoài ⇒ 422, rollback cả bài
  const far = [
    ...new Set(people.flatMap((p) => (isForeign(p, a.who.tenantId) ? [p.tenant as string] : []))),
  ];
  if (far.length > 0) {
    const ok = new Set(await mentionTenantsOk(tx, postId, far));
    if (!far.every((t) => ok.has(t))) throw notAllowed();
  }
}

/** Ghi danh sách người được nhắc của bài (thay toàn bộ). Trả id người MỚI. */
export async function saveMentions(
  tx: Tx,
  a: Access,
  postId: string,
  people: readonly Person[],
): Promise<string[]> {
  await assertSeen(tx, a, postId, people);
  return replaceMentions(tx, { tenantId: a.who.tenantId, postId, by: a.who.userId, people });
}

/** CR-191 · công ty đã kết nối + cờ «thấy bài» theo «Ai thấy bài» (`mode`/`tenants` = UUID cách nhau dấu phẩy). Đối tác ngoài ⇒ rỗng. */
export async function listConnectedAudience(
  uow: PackUow<{ tx: Tx }>,
  a: Access,
  mode: string,
  tenants: string | undefined,
): Promise<{ tenantId: string; name: string; sees: boolean }[]> {
  if (a.org !== null) return [];
  return uow.tenant(a.who, ({ tx }) => connectedAudience(tx, mode, csv(tenants)));
}

const csv = (s: string | undefined): string[] =>
  (s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/** Gợi ý người nhắc được (≤ 20, lọc `q`, không gồm chính mình). Sửa bài ⇒ theo bài (`postId`); bài mới ⇒ theo phạm vi nháp. */
/** Công ty đối tác (cộng đồng) mà người được gợi ý thuộc về: theo bài (`postId`) hoặc theo phạm vi nháp; lọc nhóm chỉ thu hẹp. */
function orgsFor(
  uow: PackUow<{ tx: Tx }>,
  a: Access,
  q: MentionablePeopleQuery,
): Promise<string[]> {
  const tenant = a.who.tenantId;
  const act = [...activeOrgIds(a)];
  return uow.tenant(a.who, async ({ tx }): Promise<string[]> => {
    if (q.postId && !(await postState(tx, q.postId))) throw appError("NOT_FOUND"); // bài chéo: `suggestCross` trước
    // CR-186: lọc nhóm CHỈ thu hẹp tập công ty đã được phép (không mở thêm quyền); «Nội bộ» ⇒ không công ty nào.
    const inGroup = (list: string[]) =>
      q.group === "internal"
        ? Promise.resolve([] as string[])
        : q.group
          ? orgsInGroup(tx, list, q.group)
          : Promise.resolve(list);
    if (a.org !== null) return inGroup([a.org]); // đối tác: chỉ công ty mình
    if (q.postId) return inGroup(await orgsSeeingPost(tx, tenant, q.postId, act));
    const type = (q.type ?? "note") as PostType;
    const def: Audience = defaultAudience(type);
    const draft: DraftScope = {
      type,
      cats: csv(q.cats),
      audience: q.mode ? { mode: q.mode, cats: csv(q.audCats), companies: csv(q.companies) } : def,
    };
    return inGroup(await orgsSeeingDraft(tx, draft, act));
  });
}

type Reach = { seeing: string[]; reach: string[]; names: Map<string, string> };

/** CR-191 · công ty đã kết nối thấy bài / bài nháp (+ tên công ty) cho gợi ý «@». */
function connectedFor(
  uow: PackUow<{ tx: Tx }>,
  a: Access,
  q: MentionablePeopleQuery,
): Promise<Reach> {
  // CR-191: `seeing` = công ty đã kết nối thấy bài; `outside=1` (ô soạn) thêm công ty KHÁC để hỏi «Thêm công ty vào / Bỏ nhắc» — chỉ gợi ý, ghi bài vẫn kiểm (422)
  return uow.tenant(
    a.who,
    async ({ tx }): Promise<{ seeing: string[]; reach: string[]; names: Map<string, string> }> => {
      if (a.org !== null || q.connected === "0" || (q.group && q.group !== "partner"))
        return { seeing: [], reach: [], names: new Map() };
      const mode = q.mode ?? defaultAudience((q.type ?? "note") as PostType).mode;
      const see = q.postId
        ? await connectedSeeingPost(tx, q.postId)
        : await connectedSeeingDraft(tx, mode, csv(q.tenants));
      // tên công ty lấy từ hàm DEFINER (người dùng hub không đọc `admin.tenants`); chỉ công ty đã kết nối
      const all = await connectedAudience(tx, "all", []);
      return {
        seeing: see,
        reach: q.outside === "1" ? all.map((x) => x.tenantId) : see,
        names: new Map(all.map((x) => [x.tenantId, x.name])),
      };
    },
  );
}

export async function suggest(
  uow: PackUow<{ tx: Tx }>,
  a: Access,
  d: MentionDeps,
  q: MentionablePeopleQuery & { limit: number },
): Promise<MentionablePerson[]> {
  const tenant = a.who.tenantId;
  const cross = await crossTarget(uow, a, q.postId);
  if (cross) return suggestCross(d, a, q, cross);
  const orgs = await orgsFor(uow, a, q);
  const { seeing, reach, names } = await connectedFor(uow, a, q);
  const members = orgs.length
    ? await d.orgMembers(tenant, orgs)
    : new Map<string, readonly string[]>();
  const hostsOn = a.org === null && (!q.group || q.group === "internal");
  const ids = [...(hostsOn ? await d.hosts(tenant) : []), ...[...members.values()].flat()];
  const rows = await d.people(
    tenant,
    ids.filter((i) => i !== a.who.userId),
    { q: q.q, limit: q.limit, offset: q.cursor ? Number(q.cursor) : 0, connectedTenants: reach },
  );
  const by = new Map(a.dir.orgs.map((o) => [o.id, o.name]));
  return rows
    .filter((p) => p.id !== a.who.userId)
    .map((p) => ({
      userId: p.id,
      name: p.name,
      ...(isForeign(p, tenant) && names.has(p.tenant as string)
        ? {
            orgName: names.get(p.tenant as string) as string,
            connected: true,
            tenantId: p.tenant as string,
            ...(seeing.includes(p.tenant as string) ? {} : { outside: true }),
          }
        : p.org && by.get(p.org)
          ? { orgName: by.get(p.org) as string }
          : {}),
      ...(p.title ? { title: p.title } : {}),
    }));
}

/** CR-191 · bài của công ty ĐÃ KẾT NỐI (người xem nội bộ, bài không ở tenant mình) ⇒ tenant + tên công ty đăng; còn lại null. */
async function crossTarget(
  uow: PackUow<{ tx: Tx }>,
  a: Access,
  postId: string | undefined,
): Promise<{ tenant: string; name: string } | null> {
  if (!postId || a.org !== null) return null;
  return uow.tenant(a.who, async ({ tx }) => {
    if (await postState(tx, postId)) return null;
    const t = await crossPostTenant(tx, postId);
    if (!t) throw appError("NOT_FOUND");
    const all = await connectedAudience(tx, "all", []);
    return { tenant: t, name: all.find((x) => x.tenantId === t)?.name ?? "" };
  });
}

/** Gợi ý «@» trên bài công ty kết nối: người thấy bài = người có quyền gói ở công ty mình + ở công ty đăng (cùng luật ghi `cross_comment_add`). */
async function suggestCross(
  d: MentionDeps,
  a: Access,
  q: MentionablePeopleQuery & { limit: number },
  c: { tenant: string; name: string },
): Promise<MentionablePerson[]> {
  const [mine, theirs] = await Promise.all([d.hosts(a.who.tenantId), d.hosts(c.tenant)]);
  const rows = await d.people(
    a.who.tenantId,
    mine.filter((i) => i !== a.who.userId),
    { q: q.q, limit: q.limit, offset: q.cursor ? Number(q.cursor) : 0, foreignIds: theirs },
  );
  return rows
    .filter(
      (p) => p.id !== a.who.userId && (p.tenant === c.tenant || !isForeign(p, a.who.tenantId)),
    )
    .map((p) => ({
      userId: p.id,
      name: p.name,
      ...(isForeign(p, a.who.tenantId)
        ? { orgName: c.name, connected: true, tenantId: c.tenant }
        : {}),
      ...(p.title ? { title: p.title } : {}),
    }));
}
