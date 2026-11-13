// CR-145 · nhắc NGƯỜI trong bài đăng. Luật "ai nhắc được ai" = luật XEM BÀI có sẵn: chủ quản nhắc được chủ quản (có quyền đọc gói,
// `packHosts`) + người của công ty đối tác thấy bài (`orgsSeeingPost`/`audience_ok`); đối tác chỉ nhắc đồng nghiệp công ty mình (không lộ
// tên người chủ quản/đối tác khác). Kiểm theo tập: danh bạ MỘT câu + `orgsSeeingPost` MỘT câu. Sai ⇒ 422 `MENTION_USER_NOT_ALLOWED`.
import type { MentionablePeopleQuery, MentionablePerson } from "@ai/contracts/community";
import type { Tx } from "@ai/db";
import { AppError, appError } from "../../../../lib/errors";
import type { PackUow } from "../../kit/public";
import { type Audience, defaultAudience, type PostType } from "../domain/audience.rules";
import { orgsSeeingPost } from "./comment-list.repo";
import type { Access } from "./community-access";
import type { PeopleReader, Person } from "./people.reader";
import { type DraftScope, orgsSeeingDraft, replaceMentions } from "./post-mention.repo";
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

/** Bước 1 (ngoài tx): id → người (còn dùng được) + kiểm bên. Người lạ/đã khoá/ngoài phạm vi bên ⇒ 422. Trả danh sách đã khử trùng. */
export async function resolvePeople(
  d: MentionDeps | undefined,
  a: Access,
  ids: readonly string[] | undefined,
): Promise<Person[]> {
  const uniq = [...new Set((ids ?? []).map((i) => i.toLowerCase()))];
  if (uniq.length === 0) return [];
  if (!d) throw notAllowed();
  const people = await d.people(a.who.tenantId, uniq);
  if (people.length !== uniq.length) throw notAllowed();
  if (a.org !== null) {
    // đối tác: chỉ người công ty mình
    if (!people.every((p) => p.org === a.org)) throw notAllowed();
    return people;
  }
  const act = activeOrgIds(a);
  if (people.some((p) => p.org !== null && !act.has(p.org))) throw notAllowed();
  if (people.some((p) => p.org === null)) {
    const hosts = new Set(await d.hosts(a.who.tenantId));
    if (!people.every((p) => p.org !== null || hosts.has(p.id))) throw notAllowed();
  }
  return people;
}

/** Bước 2 (trong tx, bài đã có): công ty của người được nhắc phải thấy bài (`orgsSeeingPost`, chỉ chủ quản cần). */
async function assertSeen(tx: Tx, a: Access, postId: string, people: readonly Person[]) {
  if (a.org !== null) return;
  const orgs = [...new Set(people.flatMap((p) => (p.org ? [p.org] : [])))];
  const seeing = new Set(await orgsSeeingPost(tx, a.who.tenantId, postId, orgs));
  if (!orgs.every((o) => seeing.has(o))) throw notAllowed();
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

const csv = (s: string | undefined): string[] =>
  (s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/** Gợi ý người nhắc được (≤ 20, lọc `q`, không gồm chính mình). Sửa bài ⇒ theo bài (`postId`); bài mới ⇒ theo phạm vi nháp. */
export async function suggest(
  uow: PackUow<{ tx: Tx }>,
  a: Access,
  d: MentionDeps,
  q: MentionablePeopleQuery & { limit: number },
): Promise<MentionablePerson[]> {
  const tenant = a.who.tenantId;
  const act = [...activeOrgIds(a)];
  const orgs = await uow.tenant(a.who, async ({ tx }): Promise<string[]> => {
    if (q.postId && !(await postState(tx, q.postId))) throw appError("NOT_FOUND");
    if (a.org !== null) return [a.org]; // đối tác: chỉ công ty mình
    if (q.postId) return orgsSeeingPost(tx, tenant, q.postId, act);
    const type = (q.type ?? "note") as PostType;
    const def: Audience = defaultAudience(type);
    const draft: DraftScope = {
      type,
      cats: csv(q.cats),
      audience: q.mode ? { mode: q.mode, cats: csv(q.audCats), companies: csv(q.companies) } : def,
    };
    return orgsSeeingDraft(tx, draft, act);
  });
  const members = orgs.length
    ? await d.orgMembers(tenant, orgs)
    : new Map<string, readonly string[]>();
  const ids = [...(a.org === null ? await d.hosts(tenant) : []), ...[...members.values()].flat()];
  const rows = await d.people(
    tenant,
    ids.filter((i) => i !== a.who.userId),
    { q: q.q, limit: q.limit },
  );
  const by = new Map(a.dir.orgs.map((o) => [o.id, o.name]));
  return rows.map((p) => ({
    userId: p.id,
    name: p.name,
    ...(p.org && by.get(p.org) ? { orgName: by.get(p.org) as string } : {}),
  }));
}
