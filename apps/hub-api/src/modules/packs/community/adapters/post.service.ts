// CR-102 · com-c3 · service bài (T-DEP-1: route chỉ gọi service): mỗi hàm MỘT tx gói (`PackUow`, RLS người xem) với số câu
// cố định. Ném `NOT_FOUND` khi bài không thấy/không phải của bên mình; 403 loại bài sai nhãn (đối tác).
import {
  BuyFieldsSchema,
  type CreatePostInput,
  SellFieldsSchema,
  type UpdatePostInput,
} from "@ai/contracts/community";
import type { Tx } from "@ai/db";
import { AppError, appError } from "../../../../lib/errors";
import { parseWith } from "../../../../lib/http";
import type { PackUow } from "../../kit/application/ports";
import {
  type Audience,
  defaultAudience,
  effectiveStatus,
  type PostAction,
  type PostType,
  partnerMayPost,
  postActions,
} from "../domain/audience.rules";
import { type Fields, storeContent } from "../domain/content.rules";
import { type Access, otherOrgNames } from "./community-access";
import { partnerRows } from "./org.repo";
import { type FeedFilter, type FeedRaw, feedQuery, type PostRow, postById } from "./post.sql";
import {
  applyAction,
  editable,
  insertPost,
  ownSource,
  postState,
  replaceChildren,
  type StateAction,
  type StateRow,
  updatePost,
} from "./post-write.repo";

type Uow = PackUow<{ tx: Tx }>;

/** Audience chủ quản: công ty phải là bạn bè (đối tác của tenant) — trần D2. */
function checkAudience(a: Access, aud: Audience | undefined): Audience | null {
  if (!aud) return null;
  const known = new Set(a.dir.orgs.map((o) => o.id));
  if (aud.companies.some((id) => !known.has(id))) throw appError("VALIDATION_ERROR");
  return aud;
}

function mergedFields(type: PostType, cur: Fields, patch: Fields | undefined): Fields {
  const next = { ...cur, ...(patch ?? {}) };
  if (type === "sell") return parseWith(SellFieldsSchema, next) as Fields;
  if (type === "buy") return parseWith(BuyFieldsSchema, next) as Fields;
  if (patch && Object.keys(patch).length > 0) throw appError("VALIDATION_ERROR");
  return {};
}

/** Việc người xem được làm trên bài (không thấy ⇒ không gì). */
function allowedOn(st: StateRow | null, org: string | null): PostAction[] {
  if (!st) return [];
  const status = effectiveStatus(st.status, new Date(st.expires_at), new Date());
  return postActions(
    { type: st.type, authorOrg: st.author_org, status, hidden: st.hidden },
    { org },
  );
}

const found = (r: PostRow | null): PostRow => {
  if (!r) throw appError("NOT_FOUND");
  return r;
};

export const feed = (uow: Uow, a: Access, f: FeedFilter): Promise<FeedRaw> =>
  uow.tenant(a.who, ({ tx }) => feedQuery(tx, a.who.tenantId, f));

/** Tạo bài; `contactDetected` = nhắc người đăng (HT-54). */
export async function create(
  uow: Uow,
  a: Access,
  input: CreatePostInput,
): Promise<{ row: PostRow; contactDetected: boolean }> {
  const audience =
    a.org === null ? (checkAudience(a, input.audience) ?? defaultAudience(input.type)) : null;
  const content = storeContent(
    { title: input.title, body: input.body, fields: input.fields as Fields },
    otherOrgNames(a),
  );
  const row = await uow.tenant(a.who, async ({ tx }) => {
    if (a.org !== null) {
      const me = (await partnerRows(tx)).find((p) => p.ext_org_id === a.org);
      if (!partnerMayPost(input.type, me?.labels ?? []))
        throw new AppError("POST_TYPE_FORBIDDEN", 403, "Post type not allowed for your company");
    }
    const id = await insertPost(tx, {
      tenantId: a.who.tenantId,
      userId: a.who.userId,
      authorName: a.dir.userName,
      org: a.org,
      type: input.type,
      content,
      cats: input.cats,
      audience,
    });
    await replaceChildren(
      tx,
      { tenantId: a.who.tenantId, postId: id },
      content.fields.raw,
      input.media,
    );
    return postById(tx, a.org === null, id);
  });
  return { row: found(row), contactDetected: content.contactDetected };
}

export async function update(
  uow: Uow,
  a: Access,
  id: string,
  input: UpdatePostInput,
): Promise<PostRow> {
  const row = await uow.tenant(a.who, async ({ tx }) => {
    const cur = await editable(tx, id, a.org);
    if (!cur) throw appError("NOT_FOUND");
    const fields = mergedFields(cur.type, cur.fields_raw, input.fields);
    const content = storeContent(
      { title: input.title ?? cur.title_raw, body: input.body ?? cur.body_raw, fields },
      otherOrgNames(a),
    );
    await updatePost(tx, id, content, {
      cats: input.cats ?? null,
      audience: checkAudience(a, input.audience),
    });
    await replaceChildren(
      tx,
      { tenantId: a.who.tenantId, postId: id },
      content.fields.raw,
      input.media ?? null,
    );
    return postById(tx, a.org === null, id);
  });
  return found(row);
}

/** Thao tác một bước; xoá ⇒ null. Việc không có trong `postActions` ⇒ 404 (không lộ tồn tại). */
export function act(uow: Uow, a: Access, id: string, action: StateAction): Promise<PostRow | null> {
  return uow.tenant(a.who, async ({ tx }) => {
    if (!allowedOn(await postState(tx, id), a.org).includes(action)) throw appError("NOT_FOUND");
    if ((await applyAction(tx, id, action)) !== 1) throw appError("NOT_FOUND");
    return action === "delete" ? null : found(await postById(tx, a.org === null, id));
  });
}

export const source = (uow: Uow, a: Access, id: string) =>
  uow.tenant(a.who, ({ tx }) => ownSource(tx, id, a.who.userId));

export const state = (uow: Uow, a: Access, id: string) =>
  uow.tenant(a.who, ({ tx }) => postState(tx, id));
